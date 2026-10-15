# 🍕 Cravey Crust — WhatsApp AI Food Ordering & Kitchen Automation Platform

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v20+-68a063?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/WhatsApp-Baileys%20v6.7-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp Baileys" />
  <img src="https://img.shields.io/badge/AI-Google%20Gemini%20%7C%20OpenAI-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="AI Engine" />
  <img src="https://img.shields.io/badge/Database-PostgreSQL%20Prisma-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

---

## 🌟 Overview

**Cravey Crust Full Bot** is an enterprise-grade, conversational food ordering, kitchen orchestration, and customer care platform designed for high-volume restaurants. Built with **Baileys (v6.7+)**, **Node.js (ESM)**, **PostgreSQL (Prisma ORM)**, and **Multi-Key LLM Failover (Gemini / OpenAI / Groq)**, it automates end-to-end food ordering on WhatsApp with zero human intervention while providing real-time kitchen tracking and management.

---

## ✨ Key Highlights & Features

### 🤖 1. Autonomous AI Food Agent ("Burger Raja")
- **Bilingual & Culturally Grounded**: Native fluency in **Roman Urdu**, **Urdu**, and **English**, speaking in a warm, welcoming Pakistani restaurant tone.
- **Dynamic Multi-Key API Failover**: Configured with automatic rotation across multiple Gemini API keys (`GEMINI_API_KEYS`), ensuring 100% uptime even if rate limits or quota caps are hit.
- **Fast-Path Intent Engine (Sub-100ms)**: Instant rule-based shortcuts for:
  - Greetings & FAQs
  - Category-filtered Deals (e.g. *Sirf Pizza Deals*, *Burger Deals*)
  - Location verification & delivery charge calculation
  - Cart modifications & payment method selection (`COD` / `EasyPaisa` / `JazzCash`)
  - Order finalization
- **Strict 4-Step Checkout Protocol**: Eliminates missed details by systematically collecting:
  1. Item Selection & Quantity
  2. Customer Full Name
  3. Precise Delivery Address / Zone
  4. Payment Method & Final Confirmation
- **Human Handover & Agent Takeover**: Automatic pause on AI when customer requests a human agent (`.handover`) or when staff intervenes from the dashboard.

---

### 💻 2. Real-Time Admin & Kitchen Web Dashboard
- **Glassmorphic Modern UI**: Responsive single-page interface accessible from desktop and mobile.
- **Live Order Board**: Real-time status pipeline (`Pending` ➜ `Confirmed` ➜ `Kitchen Preparing` ➜ `Out for Delivery` ➜ `Delivered` ➜ `Cancelled`).
- **Catalog & Deal Manager**: Instant menu updates, variants, addons, pricing, and custom combo builders.
- **Delivery Zones & Dynamic Pricing**: Zone-based flat rates and radius-based delivery pricing.
- **Interactive Live AI Prompt Editor**: Edit bot personality, business rules, and greetings directly from the UI with zero server downtime.
- **Multi-Account WhatsApp Manager**: Connect multiple WhatsApp numbers concurrently using an **8-Digit Pairing Code** or **QR Code**.

---

### ⚡ 3. Enterprise Architecture
- **In-Memory Catalog Cache**: High-performance local caching for zero-latency menu Lookups.
- **PostgreSQL + Prisma ORM**: Bulletproof relational schema ensuring atomicity of carts, orders, and customer audit trails.
- **Session Auto-Reconnection & Ratchet Healing**: Resilient WhatsApp socket with automatic token refresh, crash recovery, and auto-cleanup.
- **Rate-Limiter & Spam Defense**: Protects the bot against spam bursts and flood attacks.

---

## 🏗️ Architecture & Message Flow

```
                      ┌──────────────────────────────────────────────┐
                      │              Customer (WhatsApp)             │
                      └──────────────────────┬───────────────────────┘
                                             │
                                     [Incoming Message]
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │          Baileys Socket (bot.js)             │
                      └──────────────────────┬───────────────────────┘
                                             │
                         ┌───────────────────┴───────────────────┐
                         ▼                                       ▼
            ┌─────────────────────────┐             ┌─────────────────────────┐
            │   Admin / Command Mode  │             │   AI Ordering Pipeline  │
            │   (.menu, .mute, etc.)  │             │  (intentParser.js)      │
            └─────────────────────────┘             └────────────┬────────────┘
                                                                 │
                                          ┌──────────────────────┴──────────────────────┐
                                          ▼                                             ▼
                              ┌──────────────────────┐                      ┌──────────────────────┐
                              │  ⚡ Fast Path Route   │                      │  🧠 LLM Fallback     │
                              │  (Regex / Memory DB) │                      │  (Multi-Key Gemini)  │
                              └───────────┬──────────┘                      └───────────┬──────────┘
                                          │                                             │
                                          └──────────────────────┬──────────────────────┘
                                                                 │
                                                                 ▼
                                              ┌─────────────────────────────────────┐
                                              │     Prisma ORM & PostgreSQL DB      │
                                              │  (Orders, Cart, Menu, Delivery)     │
                                              └──────────────────┬──────────────────┘
                                                                 │
                                                                 ▼
                                              ┌─────────────────────────────────────┐
                                              │   Real-time Kitchen Web Dashboard   │
                                              │        (http://localhost:3000)      │
                                              └─────────────────────────────────────┘
```

---

## 📁 Repository Directory Structure

```text
├── auth/                 # WhatsApp Baileys session storage (gitignored)
├── commands/             # Bot WhatsApp command handlers (.menu, .handover)
├── data/                 # Custom persistent prompt configuration
├── downloads/            # Media and temporary file buffers
├── prisma/
│   ├── migrations/       # SQL migration history
│   ├── schema.prisma     # Complete relational database model
│   └── seed.js           # Menu & restaurant knowledge base seeder
├── public/               # Web Admin Dashboard frontend
│   ├── app.js            # Dashboard real-time logic
│   ├── index.html        # Dashboard single-page application
│   └── style.css         # Modern styling & theme tokens
├── routes/
│   ├── admin/            # Admin REST endpoints (orders, menu, settings, prompts)
│   ├── internal/         # Micro-service endpoints (cart, delivery, deals)
│   ├── health.js         # Health check probes
│   └── n8n.js            # Webhook integrations for external workflows
├── scripts/              # Menu population & database utilities
├── src/
│   ├── config/           # Environment variables, flags & system prompts
│   ├── db/               # Prisma database client & health checkers
│   ├── middleware/       # Admin authentication & rate limiters
│   ├── services/         # Core business logic
│   │   ├── aiAgentService.js         # LLM orchestration & prompt grounding
│   │   ├── cartService.js            # Dynamic cart computations
│   │   ├── catalogCacheService.js    # In-memory menu cache
│   │   ├── intentParser.js           # Sub-100ms fast regex matcher
│   │   ├── llmRouter.js              # Multi-Key rotation & failover engine
│   │   ├── orderService.js           # Order lifecycles & notifications
│   │   └── whatsappOrderOrchestrator.js
│   └── validators/       # Zod data schemas
├── utils/                # Location, sticker, and media conversion helpers
├── bot.js                # Core entry point & server bootstrap
├── docker-compose.yml    # Docker services orchestration
├── Dockerfile            # Container configuration
└── package.json          # Node.js dependencies & scripts
```

---

## 🚀 Quick Setup & Installation

### Prerequisites
- **Node.js**: `v20.x` or higher
- **PostgreSQL**: `v14` or higher (or Docker)
- **Git**

---

### Step 1: Clone Repository
```bash
git clone https://github.com/workwithasim/full-bot.git
cd full-bot
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```ini
# Server Port
PORT=3000

# PostgreSQL Connection
DATABASE_URL="postgresql://postgres:password@localhost:5432/cravey_db?schema=public"

# AI Configuration (Supports multiple comma-separated keys for auto-failover!)
GEMINI_API_KEY="AIzaSy...Key1"
GEMINI_API_KEYS="AIzaSy...Key1,AIzaSy...Key2,AIzaSy...Key3"
AI_PROVIDER="gemini"

# Admin Dashboard Security
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="your_strong_password"
ADMIN_SESSION_SECRET="super_secret_session_key"
```

### Step 4: Run Database Migrations & Seed
```bash
# Push Prisma schema to your database
npx prisma db push

# (Optional) Seed initial restaurant menu & deals
npm run db:seed
```

### Step 5: Start the Bot
```bash
# Development mode
npm run dev

# Or directly with node
node bot.js
```

---

## 🐳 Deployment with Docker & Docker Compose

For zero-configuration containerized deployment:

```bash
# Build and start services in background
docker compose up -d --build

# View real-time logs
docker compose logs -f app
```

---

## ⚙️ Running in Production with PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start bot process
pm2 start bot.js --name "cravey-bot"

# Save process list to restart on system reboot
pm2 save
pm2 startup
```

---

## 📱 WhatsApp Connection Methods

Once the server is running, open the dashboard at:
👉 **`http://localhost:3000`**

1. **8-Digit Pairing Code (Recommended)**:
   - Enter your phone number with country code (e.g., `923001234567`).
   - Get the 8-digit code and enter it on WhatsApp (*Linked Devices > Link with phone number*).
2. **QR Code**:
   - Scan the high-resolution QR Code displayed in the dashboard or terminal directly from your WhatsApp scanner.

---

## 🔒 Security Best Practices
- **Never commit `.env`**: Always keep your secrets safe.
- **Protected Sessions**: The `auth/` directory contains active WhatsApp tokens and is strictly excluded via `.gitignore`.
- **Admin Password**: Always change the default dashboard credentials in `.env` before production deployment.

---

## 🤝 Contributing & Support
Built with ❤️ for modern restaurant automation. If you find a bug or have a feature request, please feel free to open an issue or pull request.

**Repository**: [https://github.com/workwithasim/full-bot](https://github.com/workwithasim/full-bot)
