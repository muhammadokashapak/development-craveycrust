# WhatsApp Food Ordering & Customer Support Bot

Production-ready, multi-session WhatsApp Ordering Bot and Real-Time Admin Dashboard built with [Baileys](https://github.com/WhiskeySockets/Baileys), Express, PostgreSQL (Prisma ORM), and OpenAI.

---

## 🚀 Key Features

- **Standalone AI Food Ordering Agent**: Complete catalog grounding, conversational cart management, 4-step strict checkout protocol, and auto-fallback.
- **Multi-Session WhatsApp Support**: Connect and manage multiple WhatsApp numbers simultaneously via Pairing Code or QR Code.
- **Real-Time Admin Dashboard**:
  - Live Order Management (Pending, Confirmed, Preparing, Out for Delivery, Delivered, Cancelled).
  - Menu & Categories Catalog Manager with instant updates.
  - Deals & Combo Management.
  - Delivery Zones & Dynamic Pricing.
  - FAQs & Restaurant Information.
  - Live AI Prompt Editor with full preview and instant persistence.
  - Human Handover & Mute Controls.
- **Enterprise Architecture**:
  - PostgreSQL database with Prisma ORM.
  - Catalog in-memory cache with zero-latency querying.
  - Built-in rate limiting, session reconnection resilience, and auto-cleanup.

---

## 📁 Project Structure

```
├── auth/                 # WhatsApp session credentials (Baileys)
├── commands/             # WhatsApp bot command handlers (.menu, .mute, etc.)
├── data/                 # Custom prompt persistence storage
├── downloads/            # Temporary media and sticker downloads
├── prisma/               # Database schema, migrations, and seed scripts
├── public/               # Modern Admin Web Dashboard (HTML5, Vanilla CSS, JS)
├── routes/               # Express API routes (Admin & Internal services)
├── scripts/              # Database seeding helpers
├── src/                  # Core services (AI Agent, Cart, Orders, Pricing, Cache)
├── utils/                # Utility helpers (Media, Location, Logger, Identity)
├── bot.js                # Main server & WhatsApp socket orchestrator
├── docker-compose.yml    # Docker container configuration
├── Dockerfile            # Container build definition
└── package.json          # Dependencies & scripts
```

---

## 🛠️ Quick Start

### 1. Prerequisites
- Node.js >= 18
- PostgreSQL Database

### 2. Installation

```bash
# Clone the repository
cd "whatsapp-ordering-bot"

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your PostgreSQL credentials & OpenAI API key

# Run database migrations
npx prisma db push
```

### 3. Run the Bot

```bash
# Start bot in development / production
node bot.js
```

Dashboard will be available at:
`http://localhost:3000` (Default credentials: `admin` / `xortlogix`)

---

## 🛡️ License
Private & Confidential — Built for production use.
