require('dotenv').config({ path: './keys.env' });
const express = require('express');
const mongoose = require('mongoose');
const { GoogleGenAI, Type } = require("@google/genai");
const twilio = require('twilio');
const cron = require('node-cron');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 1. INITIALIZE API & DB
// ==========================================
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("💾 SUCCESS: Connected to MongoDB!"))
    .catch((err) => console.error("🚨 DATABASE ERROR:", err));

const PropertySchema = new mongoose.Schema({
    shortId: { type: String, unique: true }, 
    whatsappNumber: String,
    bhk: String,
    price: Number,        
    listingType: String,  
    location: String,
    furnishing: String,
    description: String,   
    mediaUrl: String,      
    mediaUrls: [String],   
    mediaType: String,    
    rawText: String,
    createdAt: { type: Date, default: Date.now }
});
const Property = mongoose.model('Property', PropertySchema);

const LeaseSchema = new mongoose.Schema({
    propertyId: String,
    ownerNumber: String,
    tenantNumber: String,
    rentAmount: Number,
    rentDay: Number, 
    ownerUpiId: String, 
    active: { type: Boolean, default: true }
});
const Lease = mongoose.model('Lease', LeaseSchema);

// ==========================================
// 2. STATE MANAGEMENT (Waiting Rooms)
// ==========================================
const pendingListings = new Map();
const pendingLeases = new Map(); 
const processedMessages = new Set(); 

// ==========================================
// 3. GEMINI AI BRAIN
// ==========================================
async function extractPropertyData(textPayload, mediaArray = []) {
    try {
        console.log(`🤖 Sending ${mediaArray.length} media item(s) to Gemini...`);
        let contents = [];
        mediaArray.forEach(media => {
            contents.push({ inlineData: { data: media.buffer.toString("base64"), mimeType: media.mimeType } });
        });
        
        contents.push(`You are an expert real estate AI. You are receiving MULTIPLE media files at once (e.g., photos AND a voice note). 
        CRITICAL INSTRUCTIONS:
        1. YOU MUST LISTEN TO THE AUDIO VOICE NOTE. The price, BHK, location, and listing type (Rent/Sale/Lease) are spoken in the audio.
        2. Based on the audio and images, write a catchy 2-sentence marketing description for the property.
        3. Do NOT fail just because the image has no text. Listen carefully to the spoken words.
        Any text provided by user: "${textPayload}".`);
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash", 
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        bhk: { type: Type.STRING },
                        price: { type: Type.NUMBER }, 
                        location: { type: Type.STRING },
                        furnishing: { type: Type.STRING },
                        listingType: { type: Type.STRING, description: "Must be 'Rent', 'Sale', or 'Lease'" },
                        description: { type: Type.STRING, description: "A catchy 2-sentence description based on the audio details." }
                    },
                    required: ["bhk", "price", "location", "listingType", "description"]
                }
            }
        });
        return JSON.parse(response.text);
    } catch (error) {
        console.error("❌ Gemini Error:", error);
        return null;
    }
}

// ==========================================
// 4. WHATSAPP WEBHOOK GATEWAY
// ==========================================
app.post('/webhook', async (req, res) => {
    const messageSid = req.body.MessageSid;
    if (processedMessages.has(messageSid)) return res.status(200).end();
    processedMessages.add(messageSid);
    setTimeout(() => processedMessages.delete(messageSid), 30000); 

    const incomingText = req.body.Body ? req.body.Body.trim() : "";
    const senderNumber = req.body.From;
    const textLower = incomingText.toLowerCase();

    // 🤝 THE OWNER VS BROKER CONVERSATION INTERCEPTOR
    if (pendingLeases.has(senderNumber)) {
        const leaseData = pendingLeases.get(senderNumber);
        
        if (leaseData.step === 'AWAITING_ROLE') {
            if (textLower === 'owner') {
                const { shortId, tenantNum, upiId, propPrice, propBhk, propLoc } = leaseData;
                const todayDay = new Date().getDate();
                const firstPaymentLink = `upi://pay?pa=${upiId}&pn=Landlord&am=${propPrice}&cu=INR`;

                await new Lease({
                    propertyId: shortId, ownerNumber: senderNumber, tenantNumber: `whatsapp:${tenantNum}`,
                    rentAmount: propPrice, rentDay: todayDay, ownerUpiId: upiId 
                }).save();

                await twilioClient.messages.create({
                    from: req.body.To, to: `whatsapp:${tenantNum}`,
                    body: `🎉 *Congratulations on your new home!*\n\nYour lease for ${propBhk} in ${propLoc} is officially active. Your rent is ₹${propPrice.toLocaleString('en-IN')}/month.\n\nYou will be paying the rent on this UPI ID from now on.\n\n👉 *Pay your first month's rent now:*\n🔗 ${firstPaymentLink}\n\nI am PropBot, and I will automatically send you a payment reminder on the ${todayDay}th of every month! 🤖🏦\n\n📞 *Contact your Landlord:* wa.me/${senderNumber.replace('whatsapp:','').replace('+','')}`
                });

                pendingLeases.delete(senderNumber);
                res.set('Content-Type', 'text/xml');
                return res.status(200).send(`<Response><Message>✅ *Lease Activated!*\n\nI have locked the property and notified the tenant. They have your contact info and the first payment link.</Message></Response>`);
                
            } else if (textLower === 'broker') {
                leaseData.step = 'AWAITING_OWNER_DETAILS';
                pendingLeases.set(senderNumber, leaseData);
                res.set('Content-Type', 'text/xml');
                return res.status(200).send(`<Response><Message>🤝 *Broker Mode Activated*\n\nTo ensure the tenant contacts and pays the real owner directly, please reply with the real owner's Phone Number and UPI ID.\n\nFormat: *[Owner_Number] [Owner_UPI]*\nExample: 8888888888 owner@bank</Message></Response>`);
            } else {
                res.set('Content-Type', 'text/xml');
                return res.status(200).send(`<Response><Message>⚠️ Please reply with exactly *Owner* or *Broker*.</Message></Response>`);
            }
        } 
        
        else if (leaseData.step === 'AWAITING_OWNER_DETAILS') {
            const parts = incomingText.split(' ');
            if (parts.length >= 2) {
                // Auto-Format the Broker-Provided Real Owner Number
                let realOwnerNum = parts[0]; 
                if (!realOwnerNum.startsWith('+91') && !realOwnerNum.startsWith('+')) {
                    realOwnerNum = '+91' + realOwnerNum;
                }
                const realOwnerUpi = parts[1];
                
                const { shortId, tenantNum, propPrice, propBhk, propLoc } = leaseData;
                const todayDay = new Date().getDate();
                const firstPaymentLink = `upi://pay?pa=${realOwnerUpi}&pn=Landlord&am=${propPrice}&cu=INR`;

                await new Lease({
                    propertyId: shortId, ownerNumber: `whatsapp:${realOwnerNum}`, tenantNumber: `whatsapp:${tenantNum}`,
                    rentAmount: propPrice, rentDay: todayDay, ownerUpiId: realOwnerUpi 
                }).save();

                await twilioClient.messages.create({
                    from: req.body.To, to: `whatsapp:${tenantNum}`,
                    body: `🎉 *Congratulations on your new home!*\n\nYour lease for ${propBhk} in ${propLoc} is officially active. Your rent is ₹${propPrice.toLocaleString('en-IN')}/month.\n\nYou will be paying the rent on this UPI ID from now on.\n\n👉 *Pay your first month's rent now:*\n🔗 ${firstPaymentLink}\n\nI am PropBot, and I will automatically send you a payment reminder on the ${todayDay}th of every month! 🤖🏦\n\n📞 *Contact your Landlord:* wa.me/${realOwnerNum.replace('+','')}`
                });

                pendingLeases.delete(senderNumber);
                res.set('Content-Type', 'text/xml');
                return res.status(200).send(`<Response><Message>✅ *Lease Activated (Broker Mode)!*\n\nProperty locked! The tenant has been given the real owner's contact info (${realOwnerNum}) and the payment link (${realOwnerUpi}).</Message></Response>`);
            } else {
                res.set('Content-Type', 'text/xml');
                return res.status(200).send(`<Response><Message>⚠️ Invalid format. Please reply with:\n*[Owner Number] [Owner UPI]*\nExample: 8888888888 owner@bank</Message></Response>`);
            }
        }
    }

    // 📋 OWNER SERVICE: Portfolio Fetcher
    if (textLower === 'my listings' || textLower === 'portfolio') {
        const myProperties = await Property.find({ whatsappNumber: senderNumber });
        res.set('Content-Type', 'text/xml');
        if (myProperties.length === 0) return res.status(200).send(`<Response><Message>You don't have any active listings right now.</Message></Response>`);

        let portfolioMsg = `📋 *Your Active Portfolio:*\n\n`;
        myProperties.forEach((p, index) => {
            portfolioMsg += `*${index + 1}. ${p.bhk} in ${p.location}*\n💰 ₹${p.price.toLocaleString('en-IN')}\n🔗 Link: https://${req.get('host')}/property/${p.shortId}\n🗑️ Delete: Text "Sold ${p.shortId}"\n\n`;
        });
        return res.status(200).send(`<Response><Message>${portfolioMsg}</Message></Response>`);
    }

    // 🧾 OWNER SERVICE: Generate Payment Receipt (Supports partial payments)
    if (textLower.startsWith('received ')) {
        const parts = incomingText.split(' ');
        const shortId = parts[1].toUpperCase();
        
        const activeLease = await Lease.findOne({ propertyId: shortId, active: true });
        res.set('Content-Type', 'text/xml');
        
        if (!activeLease) return res.status(200).send(`<Response><Message>⚠️ No active lease found for property ${shortId}.</Message></Response>`);
        if (activeLease.ownerNumber !== senderNumber) return res.status(200).send(`<Response><Message>⛔ Security Error: Only the registered landlord can issue a receipt.</Message></Response>`);
        
        // Smart Amount Logic
        let amountPaid = activeLease.rentAmount;
        if (parts.length >= 3 && !isNaN(parts[2])) {
            amountPaid = parseInt(parts[2]);
        }

        const prop = await Property.findOne({ shortId: shortId });
        const today = new Date().toLocaleDateString('en-IN');
        const receiptId = 'REC-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        const receiptMsg = `🧾 *OFFICIAL RENT RECEIPT*\n\n` +
                           `*Receipt No:* ${receiptId}\n` +
                           `*Date:* ${today}\n` +
                           `*Property:* ${prop ? prop.bhk + ' in ' + prop.location : shortId}\n` +
                           `*Amount Paid:* ₹${amountPaid.toLocaleString('en-IN')}\n\n` +
                           `✅ _Payment successfully received by landlord._\n\nThank you for using PropBot!`;

        await twilioClient.messages.create({
            from: req.body.To,
            to: activeLease.tenantNumber,
            body: receiptMsg
        });

        let confirmMsg = `✅ *Receipt Sent!*\n\nThe official payment receipt for ₹${amountPaid.toLocaleString('en-IN')} has been sent to the tenant.`;
        if (amountPaid < activeLease.rentAmount) {
            confirmMsg += `\n\n📝 _Note: This was marked as a partial/adjusted payment. Full rent is ₹${activeLease.rentAmount.toLocaleString('en-IN')}._`;
        }

        return res.status(200).send(`<Response><Message>${confirmMsg}</Message></Response>`);
    }

    // 💸 OWNER SERVICE: Start Lease (Supports "Lease..." OR "Rented... to...")
    if (textLower.startsWith('lease ') || (textLower.startsWith('rented ') && textLower.includes(' to '))) {
        const parts = incomingText.split(' ');
        if (parts.length >= 6 && parts[4].toLowerCase() === 'upi') {
            const shortId = parts[1].toUpperCase();
            
            // Auto-Format the Tenant Number
            let tenantNum = parts[3]; 
            if (!tenantNum.startsWith('+91') && !tenantNum.startsWith('+')) {
                tenantNum = '+91' + tenantNum;
            }

            const upiId = parts[5]; 
            
            const prop = await Property.findOne({ shortId: shortId });
            res.set('Content-Type', 'text/xml');
            
            if (!prop) return res.status(200).send(`<Response><Message>⚠️ Property ${shortId} not found.</Message></Response>`);
            if (prop.whatsappNumber !== senderNumber) return res.status(200).send(`<Response><Message>⛔ Security Error.</Message></Response>`);

            pendingLeases.set(senderNumber, {
                step: 'AWAITING_ROLE', shortId: shortId, tenantNum: tenantNum, upiId: upiId,
                propPrice: prop.price, propBhk: prop.bhk, propLoc: prop.location
            });

            return res.status(200).send(`<Response><Message>⏳ Almost done!\n\nBefore I lock this lease, are you the actual *Owner* of this property, or a *Broker*?\n\nReply with exactly *Owner* or *Broker*.</Message></Response>`);
        } else {
            res.set('Content-Type', 'text/xml');
            return res.status(200).send(`<Response><Message>⚠️ Invalid format. Please use:\nLease [ID] to [Number] upi [UPI_ID]</Message></Response>`);
        }
    }

    // 🗑️ OWNER SERVICE: Take Property Off Market (Supports Sold, Delete, or simple Rented)
    if (textLower.startsWith('sold ') || textLower.startsWith('delete ') || (textLower.startsWith('rented ') && !textLower.includes(' to '))) {
        const codeToFind = incomingText.split(' ')[1].toUpperCase(); 
        const propertyToDelete = await Property.findOne({ shortId: codeToFind });
        res.set('Content-Type', 'text/xml');
        
        if (!propertyToDelete) return res.status(200).send(`<Response><Message>⚠️ Property ${codeToFind} not found.</Message></Response>`);
        if (propertyToDelete.whatsappNumber !== senderNumber) return res.status(200).send(`<Response><Message>⛔ Security Error.</Message></Response>`);
        
        await Property.deleteOne({ shortId: codeToFind });
        return res.status(200).send(`<Response><Message>🗑️ *Listing Removed!*\n\nProperty *${codeToFind}* has been successfully taken off the market.</Message></Response>`);
    }

    // 📥 Download Incoming Media
    const numMedia = parseInt(req.body.NumMedia || '0'); 
    let currentMediaItems = [];
    if (numMedia > 0) {
        const twilioAuth = 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
        for (let i = 0; i < numMedia; i++) {
            const mUrl = req.body[`MediaUrl${i}`];
            const mType = req.body[`MediaContentType${i}`]; 
            const mediaResponse = await fetch(mUrl, { headers: { 'Authorization': twilioAuth } });
            currentMediaItems.push({ url: mUrl, mimeType: mType, buffer: Buffer.from(await mediaResponse.arrayBuffer()) });
        }
    }

    // 🤝 THE "ONBOARDING / RANDOM TEXT" INTERCEPTOR
    if (numMedia === 0 && !pendingListings.has(senderNumber)) {
        res.set('Content-Type', 'text/xml');
        const welcomeMessage = `👋 *Welcome to PropBot!*\n\nI am your AI Real Estate Assistant.\n\n` + 
                               `🏠 *To List a Property (Owners):*\n` +
                               `Just send me some *Photos/Videos* 📸 followed by a *Voice Note* 🎤 detailing the Price, BHK, and Location.\n` +
                               `_Commands: "My listings", "Sold [ID]", "Rented [ID] to [Number] upi [UPI]", "Received [ID] [Amount]"_\n\n` +
                               `🔑 *Looking for a Home? (Tenants):*\n` +
                               `Browse our live marketplace here: https://${req.get('host')}/listings\n`;
        return res.status(200).send(`<Response><Message>${welcomeMessage}</Message></Response>`);
    }

    // ⏳ Wait for Voice Note if Media is sent without text
    const isMediaWithoutText = numMedia > 0 && currentMediaItems.every(m => m.mimeType.startsWith('image/') || m.mimeType.startsWith('video/')) && !incomingText;
    if (isMediaWithoutText) {
        let existingMemory = pendingListings.get(senderNumber) || [];
        pendingListings.set(senderNumber, existingMemory.concat(currentMediaItems));
        res.set('Content-Type', 'text/xml');
        return res.status(200).send(`<Response><Message>Got it! 📸/🎥 \n\nSend a *Voice Note* 🎤 describing the Price, BHK, and Location to complete it.</Message></Response>`);
    }

    // 🚀 Fire everything to Gemini
    res.set('Content-Type', 'text/xml');
    res.status(200).send(`<Response><Message>⏳ Generating description and saving listing...</Message></Response>`);

    (async () => {
        let allMediaForGemini = [...currentMediaItems];
        let finalMediaUrls = [];

        currentMediaItems.forEach(item => { if (item.mimeType.startsWith('image') || item.mimeType.startsWith('video')) finalMediaUrls.push(item.url); });
        if (pendingListings.has(senderNumber)) {
            pendingListings.get(senderNumber).forEach(item => {
                allMediaForGemini.push(item);
                if (item.mimeType.startsWith('image') || item.mimeType.startsWith('video')) finalMediaUrls.push(item.url);
            });
        }

        const safeMediaForGemini = allMediaForGemini.filter(item => !item.mimeType.startsWith('video/'));
        const cleanData = await extractPropertyData(incomingText, safeMediaForGemini);

        if (cleanData && cleanData.price && cleanData.location) {
            const generatedShortId = Math.random().toString(36).substring(2, 6).toUpperCase();

            const newProperty = new Property({
                shortId: generatedShortId, whatsappNumber: senderNumber, bhk: cleanData.bhk,
                price: cleanData.price, listingType: cleanData.listingType, location: cleanData.location,
                furnishing: cleanData.furnishing, description: cleanData.description, 
                mediaUrls: finalMediaUrls, mediaType: finalMediaUrls.length > 0 ? 'image' : 'audio'
            });
            await newProperty.save();
            pendingListings.delete(senderNumber);

            await twilioClient.messages.create({
                from: req.body.To, to: senderNumber,
                body: `🏠 *Listing Live!*\n\n📍 *${cleanData.bhk} in ${cleanData.location}*\n💰 ₹${cleanData.price.toLocaleString('en-IN')}\n\n🔗 *Share with clients:* https://${req.get('host')}/property/${generatedShortId}\n\n🔑 *Delete Code:* ${generatedShortId}`
            });
        } else {
            await twilioClient.messages.create({
                from: req.body.To, to: senderNumber,
                body: `⚠️ Couldn't extract details. Please try again!`
            });
        }
    })().catch(err => console.error("🚨 Async error:", err));
});

// ==========================================
// 5. PUBLIC WEB ROUTES
// ==========================================
app.set('view engine', 'ejs');

// 🆕 FIX: Automatically redirect the main homepage to the listings page
app.get('/', (req, res) => {
    res.redirect('/listings');
});

app.get('/listings', async (req, res) => {
    try { const properties = await Property.find().sort({ createdAt: -1 }); res.render('index', { properties }); } 
    catch (err) { res.status(500).send("Server Error"); }
});

app.get('/property/:shortId', async (req, res) => {
    try {
        const prop = await Property.findOne({ shortId: req.params.shortId });
        if (!prop) return res.status(404).send("<h1 style='text-align:center; margin-top:50px;'>Property Not Found!</h1>");
        res.render('single-property', { prop });
    } catch (err) { res.status(500).send("Server Error"); }
});

app.get('/proxy-media', async (req, res) => {
    try {
        const mediaUrl = req.query.url;
        if (!mediaUrl) return res.status(400).send("No URL provided");
        const twilioAuth = 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
        const initialResponse = await fetch(mediaUrl, { headers: { 'Authorization': twilioAuth }, redirect: 'manual' });
        
        let finalBuffer, finalContentType;
        if (initialResponse.status === 301 || initialResponse.status === 302 || initialResponse.status === 307) {
            const awsResponse = await fetch(initialResponse.headers.get('location'));
            finalBuffer = Buffer.from(await awsResponse.arrayBuffer());
            finalContentType = awsResponse.headers.get('content-type');
        } else {
            finalBuffer = Buffer.from(await initialResponse.arrayBuffer());
            finalContentType = initialResponse.headers.get('content-type');
        }
        res.set('Content-Type', finalContentType || 'image/jpeg');
        res.send(finalBuffer);
    } catch (error) { res.status(500).send("Error"); }
});

// ==========================================
// 6. SECURE ADMIN ROUTES
// ==========================================
function requireAdminLogin(req, res, next) {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    if (login === 'admin' && password === 'hackathon2024') return next(); 
    res.set('WWW-Authenticate', 'Basic realm="Secure Admin Area"');
    res.status(401).send("<h1 style='text-align:center; margin-top:50px;'>🛑 Authentication Required</h1>");
}

app.get('/admin-dashboard', requireAdminLogin, async (req, res) => {
    try { const properties = await Property.find().sort({ createdAt: -1 }); res.render('admin', { properties }); } 
    catch (err) { res.status(500).send("Server Error"); }
});

app.post('/admin-delete/:id', requireAdminLogin, async (req, res) => {
    try { await Property.findByIdAndDelete(req.params.id); res.redirect('/admin-dashboard'); } 
    catch (err) { res.status(500).send("Failed to delete"); }
});

// ==========================================
// 7. CRON JOB: AUTOMATED RENT COLLECTOR
// ==========================================
cron.schedule('0 10 * * *', async () => {
    console.log("⏰ Running daily rent check...");
    const today = new Date().getDate();
    const dueLeases = await Lease.find({ active: true, rentDay: today });

    for (let lease of dueLeases) {
        const upiLink = `upi://pay?pa=${lease.ownerUpiId}&pn=Landlord&am=${lease.rentAmount}&cu=INR`;
        await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER, 
            to: lease.tenantNumber,
            body: `🔔 *Rent Reminder!*\n\nHi! It's the ${today}th, which means your rent of ₹${lease.rentAmount.toLocaleString('en-IN')} is due today.\n\nTap the link below to pay directly via GPay, PhonePe, or Paytm:\n🔗 ${upiLink}\n\nThank you!`
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));