<div align="center">

# 🍕 Cravey Crust — WhatsApp Autonomous AI Ordering & Restaurant Management Platform

An enterprise-ready, autonomous WhatsApp food ordering engine and full-featured restaurant operations dashboard built for modern cloud kitchens, franchises, and pizzerias.

[![Node.js Version](https://img.shields.io/badge/Node.js-v20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![WhatsApp Engine](https://img.shields.io/badge/WhatsApp-Baileys%20v6.7-25D366?style=flat-square&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![AI Engine](https://img.shields.io/badge/AI-Gemini%202.5%20%7C%20DeepSeek-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL%20%2B%20Prisma-336791?style=flat-square&logo=postgresql&logoColor=white)](https://www.prisma.io/)
[![Dashboard UI](https://img.shields.io/badge/Dashboard-Glassmorphic%20SPA-000000?style=flat-square&logo=express&logoColor=white)](#-admin-dashboard-modules)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[Features](#-key-features) • [Tech Stack](#-technology-stack) • [Quick Start](#-quick-start) • [Environment Setup](#-environment-configuration-env) • [Deployment](#-vps--production-deployment) • [API Overview](#-rest-api-overview)

---

</div>

## 🌟 Overview

**Cravey Crust** combines an autonomous conversational WhatsApp AI assistant with a real-time, glassmorphic administrative control center.

Customers can view live categorized menus, customize deals, select toppings and crusts, verify delivery zones, and checkout via **Cash on Delivery (COD)**, **JazzCash**, or **EasyPaisa** in **Roman Urdu**, **Urdu**, or **English** — without installing any apps.

Under the hood, incoming WhatsApp traffic is routed through a hybrid **Fast-Path Engine** (sub-50ms deterministic caching) and an intelligent **LLM Agent** with automatic multi-key fallback across Google Gemini and DeepSeek.

---

## ⚡ Key Features

### 🤖 Autonomous WhatsApp Ordering Bot
- **Grounded Food AI**: Knows every pizza size, crust type, combo deal, and kitchen item without hallucination.
- **Fast-Path Regex Core**: Zero-latency responses for greetings, menus, deals, and FAQs without unnecessary LLM token cost.
- **Multi-LLM Failover**: Automated round-robin rotation across multiple Gemini API keys with instant fallback to DeepSeek.
- **4-Step Checkout Protocol**: Reliable cart state machine (`Cart ➜ Customer Name ➜ Address Verification ➜ Payment Method`).
- **Live WhatsApp Location & Zone Check**: Automatic calculation of delivery fees and minimum spend checks based on customer area.
- **Human Handover Protocol**: `.handover` / `.takeover` commands allow staff to step in anytime while pausing AI replies.

### 💻 Glassmorphic Admin & Kitchen Dashboard
- **Live Orders Pipeline**: Real-time order Kanban board with live status transitions (`Pending` ➜ `Confirmed` ➜ `Preparing` ➜ `Out for Delivery` ➜ `Delivered`).
- **Dynamic Menu & Deal Manager**: Add, edit, or toggle items, prices, variants (Small, Medium, Large), and combo sets.
- **Universal "Delete All" Actions**: Dedicated single-click database purge buttons across every section with safety confirmations.
- **Delivery Coverage Matrix**: Configure delivery areas, boundary limits, and delivery fees.
- **Live WhatsApp Chat Audit Log**: Inspect customer conversation threads in real time, view message history, and export logs to CSV/JSON/TXT.
- **Dark & Light Mode Support**: Seamless theme switching with high-contrast legibility for night shifts.
- **Live AI Prompt Tuner**: Adjust system tone, policies, and promotional announcements on-the-fly without server restarts.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Runtime & Server** | Node.js (v20+ LTS), Express 5.2 |
| **WhatsApp Socket Engine** | `@whiskeysockets/baileys` (Multi-device pairing code & QR support) |
| **AI / LLM Integration** | Google Gemini (`gemini-2.5-flash`), DeepSeek Chat (`deepseek-chat`), OpenAI |
| **Database & ORM** | PostgreSQL 16, Prisma ORM Client & Migrations |
| **Caching & In-Memory** | High-speed In-Memory Catalog Cache with epoch synchronization |
| **Admin Frontend** | Vanilla HTML5, Modern CSS (Glassmorphism, CSS Custom Properties), Vanilla JS SPA |
| **Process Supervision** | PM2, Docker, Docker Compose |

---

## 📊 Admin Dashboard Modules

| Tab | Purpose & Features |
|---|---|
| **📋 Dashboard** | High-level metrics, daily sales volume, active orders, and quick stats |
| **🍔 Menu Items** | Category sorting, pricing, item availability toggles, variants, and bulk discounts |
| **📁 Categories** | Organize food sections, display order, and active visibility |
| **📦 Orders** | Live kitchen queue, status switcher, customer contact, and order receipt printing |
| **🎁 Meal Deals** | Multi-item bundles, combo pricing, validity dates, and inclusion lists |
| **📍 Delivery Areas** | Coverage zones, minimum order thresholds, and neighborhood delivery fees |
| **👥 Customers** | Verified customer profiles, total orders, first/last activity, and data purge tools |
| **💬 Customer Chats** | Complete WhatsApp conversation audit log, live search, and export to CSV/TXT |
| **❓ FAQ / Knowledge** | Dynamic Q&A knowledge base powering automated bot customer support |
| **🤖 Bot Prompt** | In-browser prompt editor for real-time persona and business rule adjustments |
| **⚙️ Settings** | Store hours, payment receiver numbers, tax settings, and WhatsApp socket control |

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) `>= 20.0.0`
- [PostgreSQL](https://www.postgresql.org/) `>= 14` (or Docker)
- [Git](https://git-scm.com/)

### 1. Clone the Repository
```bash
git clone https://github.com/muhammadokashapak/development-craveycrust.git
cd development-craveycrust
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create your local `.env` file from the provided template:
```bash
cp .env.example .env
```
Open `.env` and fill in your database credentials and API keys (see [Environment Configuration](#-environment-configuration-env)).

### 4. Setup the Database
```bash
# Push Prisma schema to your PostgreSQL database
npx prisma db push

# (Optional) Seed the database with Cravey Crust's default menu & deals
npm run db:seed
```

### 5. Launch the Server
```bash
npm run dev
```
The server will start at:
👉 **`http://localhost:2146`** (or the port defined in your `.env`)

---

## 📱 WhatsApp Connection Guide

1. Open the Admin Dashboard at `http://localhost:2146`.
2. Navigate to the **WhatsApp Bot** tab.
3. Choose your pairing method:
   - **8-Digit Pairing Code (Recommended)**: Enter your WhatsApp phone number with country code (e.g., `923001234567`) and click **Get Pairing Code**. Enter the 8-digit code in WhatsApp under **Linked Devices ➜ Link with phone number instead**.
   - **QR Code**: Scan the QR code displayed on the screen using WhatsApp on your phone.
4. Once connected, session tokens are securely saved in `auth/sessions/` and auto-reconnect on server reboots.

---

## ⚙️ Environment Configuration (.env)

```env
# ─── Server & Network ───
PORT=2146
SERVER_IP=localhost
PREFIX=.
OWNER_NUMBER=923001234567

# ─── Administrative Security ───
DASHBOARD_USER=admin
DASHBOARD_PASS=your_secure_password
SUPERADMIN_USER=superadmin
SUPERADMIN_PASS=your_super_password
AUTH_SECRET=your_random_64_char_secret_key

# ─── Database ───
DATABASE_URL="postgresql://user:password@localhost:5432/cravey_crust_db?schema=public"

# ─── AI Engine Configuration ───
STANDALONE_AI_ENABLED=true
AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=deepseek

# Comma-separated keys for automatic round-robin & quota failover
GEMINI_API_KEYS="AIzaSy...,AIzaSy..."
GEMINI_MODEL=gemini-2.5-flash

DEEPSEEK_API_KEYS="sk-..."
DEEPSEEK_MODEL=deepseek-chat

AI_TEMPERATURE=0.2
AI_MAX_TOKENS=1024

# ─── System Flags ───
RESTAURANT_DB_ENABLED=true
CORE_ORDER_ENGINE_ENABLED=true
WHATSAPP_ORDERING_ENABLED=true
REALTIME_DASHBOARD_ENABLED=true
KNOWLEDGE_BASE_ENABLED=true
```

---

## 🌐 VPS & Production Deployment

### Option A: Running with PM2 (Recommended for VPS)
```bash
# Install PM2 process manager
npm install -g pm2

# Deploy database migrations
npx prisma migrate deploy

# Start the application
pm2 start bot.js --name "cravey-crust"

# Save PM2 process list to auto-start on server boot
pm2 startup
pm2 save
```

### Option B: Nginx Reverse Proxy & SSL (Hostinger / Ubuntu)
```nginx
server {
    listen 80;
    server_name bot.craveycrust.com;

    location / {
        proxy_pass http://127.0.0.1:2146;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
Obtain free HTTPS certificate:
```bash
sudo certbot --nginx -d bot.craveycrust.com
```

---

## 🔌 REST API Overview

### Management APIs (`/api/admin`)
| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/orders` | `GET` | List orders with status filters |
| `/api/admin/orders/:id/status` | `PATCH` | Update order stage & notify customer |
| `/api/admin/orders/purge-all` | `POST` | Delete all orders & customer records |
| `/api/admin/menu` | `GET`, `POST` | Fetch catalog / Add new menu item |
| `/api/admin/menu/:id` | `PUT`, `DELETE` | Update or delete a menu item |
| `/api/admin/menu/delete-all` | `POST` | Wipe all menu items from database |
| `/api/admin/categories/delete-all`| `POST` | Wipe all categories & catalog items |
| `/api/admin/deals/delete-all` | `POST` | Wipe all combo deals |
| `/api/admin/delivery-areas` | `GET`, `POST` | Manage delivery zones & fees |
| `/api/admin/chats/conversations` | `GET` | View live customer WhatsApp chats |
| `/api/admin/chats/delete-all` | `POST` | Clear all customer chat history |
| `/api/admin/prompt` | `GET`, `POST` | Live AI system prompt editor |

---

## 🤖 WhatsApp Commands

| Command | Allowed Users | Action |
|---|---|---|
| `.menu` | Everyone | Sends the complete formatted menu with deals |
| `.status` | Everyone | Checks preparation & delivery status of active order |
| `.handover` | Everyone | Pauses AI responses; alerts staff for human assistance |
| `.takeover` | Staff / Admin | Resumes automated AI ordering for the chat |
| `.ping` | Staff / Admin | Tests bot socket latency and server uptime |

---

## 📁 Repository Structure

```text
development-craveycrust/
├── bot.js                      # Application entry point, Express server & Baileys socket
├── data/                       # Dynamic configurations & runtime overrides
├── prisma/
│   ├── schema.prisma           # Prisma relational database models
│   └── seed.js                 # Initial menu, deals, and delivery zones seed data
├── public/                     # Glassmorphic admin frontend SPA
│   ├── app.js                  # Frontend controllers, live sync & websocket/SSE
│   ├── index.html              # Dashboard layout & views
│   └── style.css               # Clean modern design system (Light & Dark theme)
├── routes/
│   ├── admin/                  # Administrative REST APIs (orders, menu, deals, chats)
│   └── internal/               # Fast-path cart, pricing, and address validation APIs
├── scripts/                    # Menu scraping, database sync, and maintenance scripts
├── src/
│   ├── config/                 # Environment validation & feature flags
│   ├── db/                     # Prisma database client
│   ├── middleware/             # Role-based JWT authentication & guards
│   └── services/               # AI orchestrator, LLM router, and cart engine
└── utils/                      # WhatsApp media, location, and session helpers
```

---

## 🤝 Contributing & License

Pull requests, issues, and feature proposals are welcome!

Distributed under the **MIT License**. See `LICENSE` for details.

<div align="center">
  <sub>Built with ❤️ for Cravey Crust • Next-Gen Food Automation</sub>
</div>
