# PropBot 🤖
### The AI-Powered WhatsApp Real Estate Assistant

PropBot is a comprehensive backend system built for local real estate brokers and property owners who manage inventory entirely within chat threads. This platform replaces complex, non-user-friendly real estate portals with a lightweight, conversational WhatsApp workflow that automatically converts unstructured chat messages into interactive, public web listings.

---

## 📋 Table of Contents
1. [Problem Statement](#problem-statement)
2. [Solution Architecture](#solution-architecture)
3. [Core Features](#core-features)
4. [System Architecture & Tech Stack](#system-architecture--tech-stack)
5. [Database Schema Configuration](#database-schema-configuration)
6. [Local Installation & Setup](#local-installation--setup)
7. [API & Command Reference](#api--command-reference)
8. [Strategic Production Roadmap](#strategic-production-roadmap)

---

## Problem Statement
Local real estate brokers and independent property owners frequently lack the technical background or time required to navigate complex desktop-oriented property management software or commercial listing portals. Consequently, they default to managing high-value listings, communication, and financial transactions completely inside WhatsApp. 

This creates immediate operational friction:
* **Digital Fragmentation:** Crucial property specifications, legal parameters, pricing models, and high-resolution media become instantly buried within sprawling, chaotic chat logs.
* **Loss of Information Retrieval:** When a broker needs to pitch an existing property to a new lead, they must scroll through thousands of historical messages to manually locate the matching photos and description.
* **Transaction & Record Drift:** Manually keeping tabs on which tenant owes rent to which owner's UPI ID across disjointed chats inevitably results in missed collections and manual bookkeeping errors.

---

## Solution Architecture
PropBot transforms a standard WhatsApp chat thread into an intelligent, relational data-ingestion pipeline. 

* **Zero-Friction Ingestion:** Users interact with a familiar chat client. By transmitting raw photos paired with unstructured conversational text or a voice message, the system interprets and cleans the data using artificial intelligence.
* **Instant Dynamic Portals:** The engine instantly parses the unstructured input to generate a clean, dedicated, mobile-responsive web link for each property listing.
* **Integrated Financial Ledger:** The platform links incoming tenant numbers with corresponding owner Unified Payments Interface (UPI) addresses, automatically assembling and dispatching point-to-point payment links.

---

## Core Features

### 1. Automated Property Listing Ingestion
When a user uploads a photo along with a message like *"3BHK flat in Banjara Hills near the main park, rent is 45k, deposit 90k, contact owner immediately"*, the backend leverages the **Google Gemini API** to run a named-entity recognition (NER) pass. It extracts parameters such as Location, BHK configuration, Price, and Security Deposit, commits them to the database, and saves the media references.

### 2. Live Portfolio Commands
Instead of looking up an admin dashboard, the entire platform is driven by structured WhatsApp incoming text commands:
* `My listings` -> Instructs the bot to fetch all active links associated with that broker's unique identity.
* `Delete [Listing ID]` -> Triggers a secure deletion routine from the database, instantly pulling down the live web link.

### 3. Smart Lease Activation & Payment Strings
The bot handles the configuration of payment metadata natively. By executing lease commands alongside a tenant's mobile number and the corresponding landlord's UPI address, the backend calculates payment references and compiles an instant checkout link that ensures funds travel directly to the owner with zero intermediate platform fees.

---

## System Architecture & Tech Stack

* **Frontend Engine:** EJS (Embedded JavaScript) templates combined with Tailwind CSS for utility-first styling. Optimized for viewing across mobile viewports.
* **Backend Runtime:** Node.js powered by Express.js web frameworks handling core webhook endpoints.
* **Database Management:** MongoDB Atlas utilized for persistent, document-oriented storage of spatial, structural, and relational user records.
* **Artificial Intelligence Core:** Google Gemini API configured to perform structural text sanitization and parsing on incoming multi-modal chat logs.
* **Communication Middleware:** Twilio API for WhatsApp (Sandbox environment for testing routing configurations).

---

## Database Schema Configuration

The core data layout relies on structured MongoDB models. Below are the structural specifications for the main operational models:

### Property Schema
```javascript
const propertySchema = new mongoose.Schema({
  propertyId: { type: String, required: true, unique: true },
  brokerId: { type: String, required: true },
  bhk: { type: Number, required: true },
  location: { type: String, required: true },
  price: { type: Number, required: true },
  deposit: { type: Number },
  images: [{ type: String }], 
  createdAt: { type: Date, default: Date.now }
});
```

### Lease & Transaction Schema
```javascript
const leaseSchema = new mongoose.Schema({
  leaseId: { type: String, required: true, unique: true },
  propertyId: { type: String, required: true },
  tenantMobile: { type: String, required: true },
  ownerUpiId: { type: String, required: true },
  monthlyRent: { type: Number, required: true },
  status: { type: String, enum: ['Active', 'Terminated'], default: 'Active' }
});
```

---

## Local Installation & Setup

Ensure you have Node.js (v18+) and a running MongoDB cluster instance configured before initiating setup.

### 1. Clone the Repository 
```bash
git clone [https://github.com/your-username/propbot.git](https://github.com/your-username/propbot.git)
cd propbot
npm install
```

### 2. Environment Configuration
Construct an isolated `.env` configuration file in your primary root directory:
```env
PORT=3000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/propbot
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 3. Exposing Your Local Webhook Environment
To bridge inbound traffic from Twilio's infrastructure directly onto your local environment, install and launch an `ngrok` tunnel routing through your local execution port:
```bash
ngrok http 3000
```
Copy the secure forwarding address generated (e.g., `https://<subdomain>.ngrok-free.app`) and configure it inside the **Inbound Webhook Settings** space within your Twilio WhatsApp sandbox console, pointing explicitly to your app route: `/api/whatsapp/webhook`.

### 4. Booting Up the Development Server
```bash
npm start
```

---

## API & Command Reference

| Intent Command Structure | Backend Routing Action | Response Payloads |
| :--- | :--- | :--- |
| `[Media Upload] + Unstructured Description` | Instantiates parsing pipeline via Gemini AI | Generates custom UI public landing URL link |
| `My listings` | Queries MongoDB matching sender identification metrics | Compiles dynamic array list of current active links |
| `Sold [Listing ID]` | Runs an atomic pull sequence removing matching documents | Returns verification confirming listing deletion |
| `Lease [ID] to [Tenant Number] upi [Owner UPI]` | Links payment configurations inside the database | Assembles active point-to-point UPI checkout strings |

---

## Strategic Production Roadmap

PropBot relies on the **Twilio Sandbox Environment** to execute rapid developer testing and mock incoming payloads seamlessly. While optimal for deployment validation, a production-grade rollout introduces clear system architecture upgrades:

* **Migration to WhatsApp Cloud API:** Interfacing natively with Meta’s direct Cloud API layers to completely bypass sandbox join requirements, establishing absolute session control and eliminating the need for sandbox keywords.
* **Enterprise Message Template Systems:** Constructing highly structured Interactive Component Buttons inside chat views to eliminate command syntactical errors.
* **Session State Hardening:** Implementing Redis caching layers to manage conversational states robustly when parsing long multi-part media uploads.
