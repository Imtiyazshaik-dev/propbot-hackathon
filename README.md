# PropBot 🤖
### The AI-Powered WhatsApp Real Estate Companion

PropBot is a comprehensive, production-ready backend system designed for local real estate brokers and property owners who manage inventory entirely within chat threads. This platform replaces complex, non-user-friendly real estate portals with a lightweight, conversational WhatsApp workflow that automatically converts unstructured chat messages into interactive, public web listings.

---

## 📋 Table of Contents
1. [Problem Statement](#-problem-statement)
2. [Solution Architecture](#-solution-architecture)
3. [Core Feature Workflow](#-core-feature-workflow)
4. [System Architecture & Tech Stack](#-system-architecture--tech-stack)
5. [Database Schema Configuration](#-database-schema-configuration)
6. [Local Installation & Setup](#-local-installation--setup)
7. [API & Command Reference](#-api--command-reference)
8. [Strategic Production Roadmap](#-strategic-production-roadmap)

---

## 🚨 Problem Statement
Local real estate brokers and independent property owners frequently lack the technical background or time required to navigate complex desktop-oriented property management software or commercial listing portals. Consequently, they default to managing high-value listings, communication, and financial transactions completely inside WhatsApp. 

This creates immediate operational friction:
* **Digital Fragmentation:** Crucial property specifications, legal parameters, pricing models, and high-resolution media become instantly buried within sprawling, chaotic chat logs.
* **Loss of Information Retrieval:** When a broker needs to pitch an existing property to a new lead, they must scroll through thousands of historical messages to manually locate the matching photos and description.
* **Transaction & Record Drift:** Manually keeping tabs on which tenant owes rent to which owner's UPI ID across disjointed chats inevitably results in missed collections and manual bookkeeping errors.

---

## 💡 Solution Architecture
PropBot transforms a standard WhatsApp chat thread into an intelligent, relational data-ingestion pipeline.
