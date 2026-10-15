import os
from playwright.sync_api import sync_playwright

html_content = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cravey Crust Platform Manual & Architectural Blueprint</title>
<style>
  @page {
    size: A4;
    margin: 24mm 20mm 24mm 20mm;
    @top-right {
      content: "Cravey Crust Platform Manual";
      font-size: 8.5pt;
      font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #718096;
    }
    @bottom-center {
      content: "Page " counter(page) " of " counter(pages);
      font-size: 8.5pt;
      font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #718096;
    }
  }

  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: #1a202c;
    background-color: #ffffff;
    margin: 0;
    padding: 0;
  }

  /* Headings */
  h1, h2, h3, h4, h5, h6 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    font-weight: 700;
    line-height: 1.3;
  }

  h1.book-title {
    font-size: 26pt;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin-bottom: 8px;
    color: #0f172a;
  }

  .subtitle {
    font-size: 13pt;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #475569;
    font-weight: 400;
    margin-bottom: 24px;
    line-height: 1.4;
  }

  .meta-box {
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 12px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 9pt;
    color: #64748b;
    margin-bottom: 35px;
    display: flex;
    justify-content: space-between;
  }

  h1.chapter {
    font-size: 19pt;
    margin-top: 36px;
    margin-bottom: 16px;
    padding-bottom: 6px;
    border-bottom: 2px solid #0f172a;
    page-break-before: always;
  }

  h1.chapter:first-of-type {
    page-break-before: avoid;
  }

  h2 {
    font-size: 14pt;
    margin-top: 24px;
    margin-bottom: 10px;
    color: #1e293b;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 4px;
  }

  h3 {
    font-size: 11.5pt;
    margin-top: 18px;
    margin-bottom: 8px;
    color: #334155;
  }

  p {
    margin-top: 0;
    margin-bottom: 12px;
    text-align: justify;
  }

  ul, ol {
    margin-top: 0;
    margin-bottom: 14px;
    padding-left: 24px;
  }

  li {
    margin-bottom: 6px;
  }

  /* Code & Pre */
  code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 9pt;
    background-color: #f1f5f9;
    padding: 2px 5px;
    border-radius: 4px;
    color: #0f172a;
  }

  pre {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 8.5pt;
    line-height: 1.45;
    background-color: #0f172a;
    color: #e2e8f0;
    padding: 14px 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 14px 0 16px 0;
    page-break-inside: avoid;
  }

  pre code {
    background-color: transparent;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }

  /* Callout Boxes */
  .callout {
    padding: 12px 16px;
    margin: 16px 0;
    border-left: 4px solid #3b82f6;
    background-color: #f8fafc;
    border-radius: 0 6px 6px 0;
    font-size: 9.5pt;
    page-break-inside: avoid;
  }

  .callout-title {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-weight: 700;
    color: #1e3a8a;
    margin-bottom: 4px;
  }

  .callout.warning {
    border-left-color: #f59e0b;
    background-color: #fffbeb;
  }
  .callout.warning .callout-title {
    color: #92400e;
  }

  .callout.important {
    border-left-color: #ef4444;
    background-color: #fef2f2;
  }
  .callout.important .callout-title {
    color: #991b1b;
  }

  .callout.tip {
    border-left-color: #10b981;
    background-color: #f0fdf4;
  }
  .callout.tip .callout-title {
    color: #065f46;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0 20px 0;
    font-size: 9pt;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    page-break-inside: avoid;
  }

  th, td {
    padding: 8px 10px;
    text-align: left;
    border: 1px solid #cbd5e1;
  }

  th {
    background-color: #f1f5f9;
    font-weight: 600;
    color: #0f172a;
  }

  tr:nth-child(even) td {
    background-color: #f8fafc;
  }

  /* Diagrams & Visuals */
  .diagram-box {
    background-color: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 16px;
    margin: 16px 0;
    font-family: 'Consolas', monospace;
    font-size: 8pt;
    line-height: 1.4;
    white-space: pre;
    color: #0f172a;
    page-break-inside: avoid;
  }

  /* Table of Contents */
  .toc {
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 18px 24px;
    margin: 24px 0 35px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .toc-title {
    font-size: 13pt;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 12px;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 6px;
  }

  .toc-list {
    list-style-type: none;
    padding-left: 0;
    margin: 0;
  }

  .toc-item {
    display: flex;
    justify-content: space-between;
    margin-bottom: 7px;
    font-size: 9.5pt;
    color: #334155;
  }

  .toc-chapter {
    font-weight: 600;
    color: #0f172a;
  }

  .page-break {
    page-break-after: always;
  }
</style>
</head>
<body>

<!-- Title Block -->
<h1 class="book-title">Cravey Crust Automation Platform</h1>
<div class="subtitle">Complete Technical Manual, Architectural Blueprint & Operational Handbook</div>

<div class="meta-box">
  <div><strong>Author:</strong> Cravey Systems Engineering</div>
  <div><strong>Document Type:</strong> System Book & Reference Guide</div>
  <div><strong>Version:</strong> 2.4.0 (Enterprise Edition)</div>
  <div><strong>Target Stack:</strong> Node.js 20+ · Baileys · PostgreSQL · Prisma · Multi-LLM</div>
</div>

<!-- Executive Summary -->
<div class="callout tip">
  <div class="callout-title">PURPOSE OF THIS MANUAL</div>
  This volume provides an exhaustive, book-style technical manual for the <strong>Cravey Crust WhatsApp Autonomous Food Ordering & Kitchen Automation Platform</strong>. It details the real-world motivations behind its development (<em>Kyun Banaya</em>), the complete technological stack and design patterns selected (<em>Kia Stack Use Kiya</em>), a rigorous step-by-step installation and operational guide (<em>Kese Use Karein</em>), the internal state machines governing conversational commerce, database relational schemas, REST API surfaces, and maintenance protocols.
</div>

<!-- Table of Contents -->
<div class="toc">
  <div class="toc-title">Table of Contents</div>
  <ul class="toc-list">
    <li class="toc-item"><span class="toc-chapter">Chapter 1: The Problem Space & Business Motivation (Kyun Banaya?)</span><span>Page 2</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 2: Technical Stack & Architectural Decisions (Kia Stack Use Kiya?)</span><span>Page 4</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 3: The Hybrid Engine: Fast-Path Regex & Multi-LLM Failover</span><span>Page 7</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 4: End-to-End Operational Workflow & Ordering Lifecycle</span><span>Page 10</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 5: Step-by-Step Installation & Environment Setup</span><span>Page 13</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 6: WhatsApp Connection & Multi-Session Pairing Manual</span><span>Page 16</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 7: Kitchen & Administration Web Dashboard Manual</span><span>Page 18</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 8: Relational Database Schema & Prisma ORM Blueprint</span><span>Page 21</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 9: Complete REST API & System Probes Reference</span><span>Page 24</span></li>
    <li class="toc-item"><span class="toc-chapter">Chapter 10: Bot Commands, Production Hardening & Troubleshooting</span><span>Page 26</span></li>
  </ul>
</div>

<div class="page-break"></div>

<!-- CHAPTER 1 -->
<h1 class="chapter">Chapter 1: The Problem Space & Business Motivation (Kyun Banaya?)</h1>

<h2>1.1 The High Cost and Friction of Food Aggregators</h2>
<p>
For high-volume restaurants, cloud kitchens, and emerging food franchises, customer acquisition and retention are frequently compromised by traditional third-party food delivery platforms (such as Foodpanda, UberEats, and Deliveroo). These aggregators impose commissions ranging between <strong>22% to 35% on every single order</strong>. For a food establishment operating on a 15% to 20% net profit margin, these commissions effectively consume all underlying profitability, forcing businesses into unsustainable pricing models.
</p>
<p>
Furthermore, aggregators intentionally blindfold the restaurant from its own customers. The restaurant receives a masked phone number, lacks insight into purchase frequency, and cannot execute direct remarketing or loyalty incentives. In essence, the restaurant functions merely as an outsourced cooking line for the aggregator's proprietary customer base.
</p>

<h2>1.2 The Failure of Proprietary Mobile Apps</h2>
<p>
In response to aggregator fees, many restaurants spend significant capital developing standalone Android and iOS mobile applications. However, customer conversion and retention on standalone apps remain abysmally low due to measurable consumer friction:
</p>
<ul>
  <li><strong>Download Hesitation:</strong> Consumers are reluctant to download a 50MB-120MB app merely to order a pizza once every two weeks.</li>
  <li><strong>Authentication Barriers:</strong> Forgotten passwords, multi-step email verifications, and mandatory profile creation result in a 65%+ cart abandonment rate at the authentication screen.</li>
  <li><strong>Storage & Notification Fatigue:</strong> Consumers frequently delete rarely used apps or disable push notifications, negating the restaurant's marketing spend.</li>
</ul>

<h2>1.3 The WhatsApp Advantage</h2>
<p>
In contrast to proprietary apps, <strong>WhatsApp is already installed on over 92% of all smartphones</strong> in Pakistan, South Asia, the Middle East, and Latin America. It is opened dozens of times daily, requires no onboarding or password authentication, and enjoys an open rate of over 95%. Ordering food via WhatsApp is an organic, effortless behavior that mirrors how consumers interact with friends and family.
</p>

<h2>1.4 The Human Bottleneck in Traditional WhatsApp Ordering</h2>
<p>
Historically, restaurants attempting to take orders manually via WhatsApp run into severe operational gridlocks:
</p>
<ol>
  <li><strong>Peak-Time Bottlenecks:</strong> Between 7:30 PM and 10:30 PM (dinner rush), a restaurant may receive 80 to 200 concurrent incoming chats. Two or three human order takers cannot read, type, clarify addresses, calculate totals, and record orders fast enough. Customers experience 15-25 minute response delays and abandon their carts to competitors.</li>
  <li><strong>Human Transcription Errors:</strong> Manual order booking leads to misheard pizza sizes, forgotten add-ons, inaccurate manual delivery fee calculations, and misspelled customer addresses.</li>
  <li><strong>Bilingual Communication Hurdles:</strong> In Pakistan, customers naturally communicate in <strong>Roman Urdu</strong> (Urdu written in Latin letters, e.g., <em>"Aik large fajita pizza kr do aur 2 cold drink"</em>), mixed English, or Urdu script. Traditional rule-based chatbots cannot parse linguistic nuances, slang, spelling variations, or informal negotiations.</li>
</ol>

<h2>1.5 The Core Mission of Cravey Crust</h2>
<p>
The <strong>Cravey Crust Full Bot</strong> was designed and engineered specifically to bridge these systemic flaws. It delivers an autonomous, high-throughput software system that:
</p>
<ul>
  <li>Operates 24/7 directly inside WhatsApp with zero human labor required for 95%+ of incoming standard orders.</li>
  <li>Possesses native bilingual comprehension of <strong>Roman Urdu, English, and Urdu</strong>, speaking with a warm, culturally resonant restaurant persona (<em>"Burger Raja"</em>).</li>
  <li>Responds in <strong>sub-100 milliseconds</strong> for standard catalog browsing and frequently asked questions via an in-memory fast-path engine.</li>
  <li>Guarantees <strong>zero order omissions</strong> through a deterministic 4-step ordering protocol (Item Selection ➜ Full Name ➜ Verified Delivery Zone ➜ Payment Confirmation).</li>
  <li>Provides human kitchen staff and managers with a real-time, glassmorphic visual <strong>Kitchen Kanban Dashboard</strong> for order dispatch and fulfillment.</li>
  <li>Eliminates platform commission fees completely.</li>
</ul>

<div class="page-break"></div>

<!-- CHAPTER 2 -->
<h1 class="chapter">Chapter 2: Technical Stack & Architectural Decisions (Kia Stack Use Kiya?)</h1>

<h2>2.1 High-Level Component Topology</h2>
<p>
The Cravey Crust platform adopts a modular, service-oriented architecture designed to ensure fault tolerance, zero-downtime menu synchronization, low latency, and deterministic order persistence.
</p>

<div class="diagram-box">
┌────────────────────────────────────────────────────────────────────────┐
│                        CUSTOMER CHAT INTERFACE                         │
│                  WhatsApp Multi-Device Client (Mobile / Web)           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSockets (TLS)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  SOCKET & SESSION LAYER (Baileys v6.7+)                 │
│  • Multi-Session Auth Engine           • 8-Digit Pairing Code Daemon   │
│  • Rate Limiter & Spam Defense         • Automated Ratchet Reconnect   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
┌──────────────────────────────────┐ ┌───────────────────────────────────┐
│     FAST-PATH ROUTER (Regex)     │ │     AI AGENT ORCHESTRATION        │
│  • Sub-100ms In-Memory Latency   │ │  • Dynamic Context Grounding      │
│  • Greetings, Deals, Clear Cart  │ │  • Multi-Key Gemini Round-Robin   │
│  • Zero LLM API Token Cost       │ │  • DeepSeek & OpenAI Failover     │
└─────────────────┬────────────────┘ └─────────────────┬─────────────────┘
                  │                                   │
                  └─────────────────┬─────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    BUSINESS LOGIC & DOMAIN SERVICES                    │
│  • CartService (Taxes, Add-ons)        • OrderService (Lifecycles)     │
│  • DeliveryEngine (Polygon Verification)• CatalogCacheService (Memory) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 PERSISTENCE LAYER (PostgreSQL 16 + Prisma)             │
│  • ACID Compliant Transactions         • Automated Schema Migrations   │
│  • In-Memory Fast Cache Synchronization• Relational Integrity Guarantees│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   REAL-TIME KITCHEN & ADMIN DASHBOARD                  │
│  • Express 5 REST APIs                 • Glassmorphic Responsive SPA   │
│  • Live Kanban Dispatch Board          • Dynamic System Prompt Tuner   │
└────────────────────────────────────────────────────────────────────────┘
</div>

<h2>2.2 Justification of Technology Stack</h2>

<h3>1. Node.js (v20+ LTS, ECMAScript Modules)</h3>
<p>
Node.js was selected for its single-threaded, non-blocking asynchronous event loop. In conversational platforms, the runtime is predominantly I/O-bound: managing hundreds of persistent WebSocket connections, querying databases, handling HTTP network streams to LLM APIs, and broadcasting real-time dashboard events. The native ESM structure provides strict modularity, high tree-shaking efficiency, and immediate module loading.
</p>

<h3>2. WhatsApp Engine: @whiskeysockets/baileys (v6.7+)</h3>
<p>
Unlike official Meta WhatsApp Cloud APIs, which charge substantial per-conversation conversation fees ($0.03 to $0.07 per user conversation) and enforce rigid interactive message templates that prevent natural Roman Urdu conversational flow, <strong>Baileys connects directly to WhatsApp's multi-device WebSockets infrastructure</strong>:
</p>
<ul>
  <li><strong>Zero Per-Message Cost:</strong> The restaurant pays zero messaging fees regardless of whether they process 100 or 10,000 orders monthly.</li>
  <li><strong>8-Digit Pairing Code Support:</strong> Eliminates the traditional need to screenshot a QR code with a secondary phone. Staff simply enter their phone number on the dashboard and receive an 8-digit link code natively inside WhatsApp.</li>
  <li><strong>Cryptographic Session Storage:</strong> Stores authentication ratchets, identity keys, and pre-keys securely inside the local file system (`auth/`), allowing instantaneous auto-reconnects on system reboot.</li>
</ul>

<h3>3. Database Layer: PostgreSQL 16 & Prisma ORM</h3>
<p>
Food orders require strict relational consistency, atomicity, and financial accuracy. A cart item must reference valid menu variants, modifiers, and real-time delivery zone pricing.
</p>
<ul>
  <li><strong>PostgreSQL 16:</strong> Offers robust ACID guarantees, jsonb support for arbitrary customer metadata, and rock-solid transaction isolation levels that prevent double-booking.</li>
  <li><strong>Prisma ORM:</strong> Provides compile-time type safety, automated migration generators (`prisma migrate`), declarative relational definitions in `schema.prisma`, and a powerful schema management GUI (`npx prisma studio`).</li>
</ul>

<h3>4. In-Memory Catalog Cache (catalogCacheService.js)</h3>
<p>
During peak traffic, hundreds of users browse pizza deals and menu categories concurrently. Querying the relational database for static menu items on every keystroke induces unnecessary database I/O load. <code>catalogCacheService</code> maintains an in-memory synchronized clone of the active catalog, variants, and deals, reducing menu read latency from 45ms (database query) to <strong>less than 2ms</strong> (RAM lookup).
</p>

<h3>5. Real-Time Admin Frontend: Express 5 + Modern Glassmorphic SPA</h3>
<p>
The kitchen and admin dashboard (served from `/public`) was built deliberately using <strong>Vanilla ES6+ JavaScript, semantic HTML5, and native CSS3 Glassmorphism</strong> rather than complex frontend frameworks (Next.js, React, or Angular):
</p>
<ul>
  <li><strong>Zero Build Latency:</strong> No Webpack, Vite, or npm build steps required on the production server. Changes are immediately hot-served.</li>
  <li><strong>Minimal Footprint:</strong> Runs seamlessly on budget 1GB-RAM Linux VPS instances or local kitchen POS computers without consuming excessive CPU or RAM.</li>
  <li><strong>Cross-Device Compatibility:</strong> Perfectly responsive on low-cost Android kitchen tablets, desktop monitors, and iPhones.</li>
</ul>

<div class="page-break"></div>

<!-- CHAPTER 3 -->
<h1 class="chapter">Chapter 3: The Hybrid Engine: Fast-Path Regex & Multi-LLM Failover</h1>

<h2>3.1 The Deterministic Fast-Path Engine (Sub-100ms)</h2>
<p>
A common anti-pattern in AI chatbots is routing every single user utterance directly to an external LLM API. This introduces 1,500ms to 3,500ms of network latency, exhausts third-party API quotas, and introduces non-deterministic hallucinations into basic conversational flows.
</p>
<p>
Cravey Crust implements an upfront <strong>Deterministic Intent Parser (<code>src/services/intentParser.js</code>)</strong>. Before invoking any external AI engine, incoming customer messages are evaluated against normalized regex matrices:
</p>

<table>
  <thead>
    <tr>
      <th>Customer Utterance (Example)</th>
      <th>Matched Fast-Path Intent</th>
      <th>Engine Execution</th>
      <th>Response Latency</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><em>"Salam", "Hi", "Hello", "Menu dikhao"</em></td>
      <td><code>INTENT_GREETING_MENU</code></td>
      <td>Fetches top categories from <code>catalogCacheService</code> & outputs formatted greeting.</td>
      <td><strong>~40ms</strong></td>
    </tr>
    <tr>
      <td><em>"Pizza deals", "Deals kya hain"</em></td>
      <td><code>INTENT_CATEGORY_DEALS</code></td>
      <td>Filters cache for active bundle deals and prints formatted pricing list.</td>
      <td><strong>~55ms</strong></td>
    </tr>
    <tr>
      <td><em>"Cart clear kr do", "Order cancel"</em></td>
      <td><code>INTENT_CLEAR_CART</code></td>
      <td>Deletes customer's active pending cart in Prisma and confirms reset.</td>
      <td><strong>~70ms</strong></td>
    </tr>
    <tr>
      <td><em>"Store timing kya hai", "Location kahan hai"</em></td>
      <td><code>INTENT_STORE_INFO</code></td>
      <td>Reads operational hours and physical address directly from cache.</td>
      <td><strong>~35ms</strong></td>
    </tr>
    <tr>
      <td><em>"Mujhe agent se baat karni hai", ".handover"</em></td>
      <td><code>INTENT_HANDOVER</code></td>
      <td>Sets <code>isHandoverActive: true</code>, silences bot, and notifies kitchen dashboard.</td>
      <td><strong>~60ms</strong></td>
    </tr>
  </tbody>
</table>

<h2>3.2 Dynamic Context Grounding for Complex Queries</h2>
<p>
When an utterance requires semantic reasoning (e.g., <em>"Hum 4 dost hain, koi aisi deal batao jisme 2 pizza aur wings hon aur Rs. 3000 se kam ho"</em>), the message bypasses the fast-path engine and is routed to the <strong>AI Agent Service (<code>src/services/aiAgentService.js</code>)</strong>.
</p>
<p>
To ensure the LLM never hallucinates items not currently in stock or invents fictional prices, the orchestrator executes <strong>Real-Time Dynamic Prompt Grounding</strong>:
</p>
<ol>
  <li>The customer's current cart state, item quantities, and subtotal are injected into the system prompt.</li>
  <li>The active menu catalog (with real prices, available sizes, and descriptions) is summarized and appended.</li>
  <li>Active store operational rules (minimum order limits, delivery areas) are appended.</li>
  <li>The model is strictly instructed to return both a natural conversational response in Roman Urdu/English and an optional structured JSON payload instructing the cart service to add, modify, or delete line items.</li>
</ol>

<h2>3.3 Multi-Key & Multi-Provider Round-Robin Failover Architecture</h2>
<p>
The single greatest operational hazard for an AI-driven restaurant bot is a <code>HTTP 429 Resource Exhausted</code> or rate-limit error during the dinner rush. Cravey Crust solves this through an enterprise <strong>Multi-Key Round-Robin & Fallback Router (<code>src/services/llmRouter.js</code>)</strong>.
</p>

<div class="diagram-box">
┌────────────────────────────────────────────────────────────────────────┐
│                      INCOMING GROUNDED AI REQUEST                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        LLM ROUTER DISPATCHER                           │
│  Tracks key health, quota exhaustion counters, and active index       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼ (Try 1)             ▼ (Try 2)             ▼ (Try 3)
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│   GEMINI KEY #1 (Active)│ │   GEMINI KEY #2 (Backup)│ │   GEMINI KEY #3 (Backup)│
│   gemini-2.5-flash      │ │   gemini-2.5-flash      │ │   gemini-2.5-flash      │
└─────────────┬───────────┘ └───────────┬─────────────┘ └───────────┬─────────────┘
              │ Success?                │ Success?                  │ Success?
              ├───────────► 200 OK ◄────┴─────────────► 200 OK ◄────┤
              │ (If 429/Error)          │ (If 429/Error)            │ (If 429/Error)
              └───────────────┬─────────┴─────────────┬─────────────┘
                              │ All Gemini Keys Fail  │
                              ▼                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                CIRCUIT BREAKER: FALLBACK PROVIDER #1                   │
│            DeepSeek Chat API (deepseek-chat via DEEPSEEK_API_KEYS)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ If Network / Provider Outage
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                SAFETY NET: FALLBACK PROVIDER #2                        │
│            OpenAI API (gpt-4o-mini via OPENAI_API_KEYS)                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 200 OK
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│           SUCCESSFUL RESPONSE RETURNED TO WHATSAPP ORCHESTRATOR        │
└────────────────────────────────────────────────────────────────────────┘
</div>

<p>
<strong>Key Rotation Details:</strong>
</p>
<ul>
  <li><code>GEMINI_API_KEYS</code> accepts a comma-separated list of keys in `.env` (e.g. <code>AIzaSyA...,AIzaSyB...,AIzaSyC...</code>).</li>
  <li>Keys rotate on a round-robin index. If Key #1 encounters a rate limit (429) or transient error (503), it is marked in a temporary cooldown window and Key #2 is immediately tried with zero delay to the customer.</li>
  <li>If all configured Gemini keys fail, the router triggers a circuit break and routes the payload to <code>AI_FALLBACK_PROVIDER</code> (DeepSeek Chat), followed by OpenAI.</li>
</ul>

<div class="page-break"></div>

<!-- CHAPTER 4 -->
<h1 class="chapter">Chapter 4: End-to-End Operational Workflow & Ordering Lifecycle</h1>

<h2>4.1 The 4-Step Checkout Protocol</h2>
<p>
To prevent abandoned, vague, or unserviceable orders, Cravey Crust implements a deterministic 4-step state machine. The bot will never commit an order to the kitchen without strictly validating all four criteria:
</p>

<div class="diagram-box">
 ┌────────────────┐     ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
 │     STEP 1     │     │     STEP 2     │     │     STEP 3     │     │     STEP 4     │
 │ Item Selection │ ──► │ Customer Name  │ ──► │ Delivery Zone  │ ──► │ Payment Method │
 │   & Cart Build │     │  Verification  │     │   Validation   │     │  Confirmation  │
 └────────────────┘     └────────────────┘     └────────────────┘     └────────────────┘
</div>

<h3>Step 1: Item Selection & Cart Assembly</h3>
<p>
The customer selects one or more items (e.g. <em>"1 Large Fajita Pizza and 1 Garlic Bread"</em>). The item names are matched against the database catalog. The bot confirms the addition, provides the running subtotal, and automatically inquires about crust preference or drinks if applicable.
</p>

<h3>Step 2: Customer Name Verification</h3>
<p>
If the customer's phone number is already registered in the PostgreSQL <code>Customer</code> table from a previous order, their name is pre-populated (e.g., <em>"Asim bhai, aapka naam Asim Khan hi use karein?"</em>). For new users, the bot systematically requests their full name to attach to the kitchen ticket.
</p>

<h3>Step 3: Delivery Zone Verification & Fee Calculation</h3>
<p>
The customer shares their street address, sector, or sends a native WhatsApp Live Location. The <strong>Delivery Verification Engine</strong> compares the input against active records in <code>DeliveryArea</code>:
</p>
<ul>
  <li>If the address falls within an approved zone (e.g., <em>"Sector F-8"</em>), the zone's flat delivery charge (e.g., Rs. 150) is calculated and added to the order bill.</li>
  <li>If the total order amount does not satisfy the zone's <code>minOrderAmount</code>, the bot politely notifies the user how much more they need to add to qualify.</li>
  <li>If the location is out of bounds, the customer is gently informed that delivery is unavailable and offered self-pickup instead.</li>
</ul>

<h3>Step 4: Payment Selection & Kitchen Commitment</h3>
<p>
The bot presents the final itemized receipt and requests payment method selection:
</p>
<ol>
  <li><strong>Cash on Delivery (COD)</strong></li>
  <li><strong>JazzCash</strong> (Displays restaurant merchant tilt ID / account number)</li>
  <li><strong>EasyPaisa</strong> (Displays account details and requests transaction ID / screenshot)</li>
</ol>
<p>
Upon confirmation, the status updates from <code>CART</code> to <code>PENDING</code> in the database. A real-time notification rings on the kitchen dashboard, and a confirmation ticket with an estimated delivery window (35-45 mins) is sent to the customer.
</p>

<h2>4.2 Human Handover & Staff Intervention Protocol</h2>
<p>
Automation should never alienate customers requiring custom assistance. Cravey Crust incorporates an instantaneous handover protocol:
</p>
<ul>
  <li><strong>Customer Trigger:</strong> If a customer types <code>.handover</code> or phrases like <em>"Mujhe kisi insan ya manager se baat karni hai"</em>, the bot sets <code>isHandoverActive = true</code> for that specific customer record.</li>
  <li><strong>Dashboard Takeover:</strong> Kitchen staff can click <strong>"Takeover Chat"</strong> directly on the web dashboard.</li>
  <li><strong>AI Suppression:</strong> While handover is active, the AI engine completely suppresses its automated replies for that user. Human staff can chat with the customer normally through the physical WhatsApp phone or web dashboard.</li>
  <li><strong>Resume Automation:</strong> Once the inquiry is resolved, staff can click <strong>"Resume AI"</strong> on the dashboard or send <code>.takeover</code> from the admin phone to hand control back to the bot.</li>
</ul>

<div class="page-break"></div>

<!-- CHAPTER 5 -->
<h1 class="chapter">Chapter 5: Step-by-Step Installation & Environment Setup</h1>

<h2>5.1 Prerequisites</h2>
<p>Before installing the platform, ensure the hosting environment meets the following specifications:</p>
<table>
  <thead>
    <tr>
      <th>Component</th>
      <th>Minimum Specification</th>
      <th>Recommended Specification</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Operating System</strong></td>
      <td>Ubuntu 20.04 LTS / Windows 10</td>
      <td>Ubuntu 22.04 / 24.04 LTS (64-bit)</td>
    </tr>
    <tr>
      <td><strong>Node.js Runtime</strong></td>
      <td>v20.0.0</td>
      <td>v20.18.0 LTS or v22.x LTS</td>
    </tr>
    <tr>
      <td><strong>Database</strong></td>
      <td>PostgreSQL 14</td>
      <td>PostgreSQL 16 (Local or Managed RDS)</td>
    </tr>
    <tr>
      <td><strong>RAM / CPU</strong></td>
      <td>1 GB RAM / 1 vCPU</td>
      <td>2 GB - 4 GB RAM / 2 vCPUs</td>
    </tr>
    <tr>
      <td><strong>System Dependencies</strong></td>
      <td>Git, OpenSSL</td>
      <td>Git, OpenSSL, FFmpeg (for media/stickers)</td>
    </tr>
  </tbody>
</table>

<h2>5.2 Option A: Local / Native Linux & Windows Installation</h2>

<h3>Step 1: Clone Repository</h3>
<pre><code>git clone https://github.com/workwithasim/full-bot.git
cd full-bot</code></pre>

<h3>Step 2: Install Node Dependencies</h3>
<pre><code>npm install</code></pre>

<h3>Step 3: Configure Environment Variables</h3>
<pre><code>cp .env.example .env</code></pre>
<p>Open <code>.env</code> in your editor and configure the essential parameters:</p>
<pre><code>PORT=3000
SERVER_IP=localhost
PREFIX=.
OWNER_NUMBER=923001234567

# Admin Dashboard Security
DASHBOARD_USER=admin
DASHBOARD_PASS=your_secure_password_here

# PostgreSQL Database Connection URI
DATABASE_URL="postgresql://postgres:password@localhost:5432/cravey_crust?schema=public"

# AI Configuration (Comma-separated keys for auto-rotation)
STANDALONE_AI_ENABLED=true
AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=deepseek
GEMINI_API_KEYS="AIzaSyKey1,AIzaSyKey2,AIzaSyKey3"
GEMINI_MODEL="gemini-2.5-flash"</code></pre>

<h3>Step 4: Execute Database Migrations & Initial Data Seeding</h3>
<pre><code># Push schema models to PostgreSQL
npx prisma db push

# Generate Prisma Client
npm run db:generate

# Populate database with initial pizza deals, categories, and delivery areas
npm run db:seed</code></pre>

<h3>Step 5: Start Application</h3>
<pre><code># For development (auto-restarts on file edit)
npm run dev

# Or directly with Node
node bot.js</code></pre>

<h2>5.3 Option B: One-Click Production Deployment with Docker Compose</h2>
<p>
The repository includes a production-grade <code>docker-compose.yml</code> file that automatically provisions the Node.js application, an isolated PostgreSQL 16 database container, and persistent host volumes.
</p>
<pre><code># 1. Clone repository
git clone https://github.com/workwithasim/full-bot.git
cd full-bot

# 2. Setup your .env file
cp .env.example .env

# 3. Build and launch services in background
docker compose up -d --build

# 4. View live logs from the bot container
docker compose logs -f app</code></pre>
<p>To safely shut down the containers while preserving all order history and sessions:</p>
<pre><code>docker compose down</code></pre>

<h2>5.4 Option C: Process Supervision with PM2 (Bare-Metal VPS)</h2>
<p>
When running directly on an Ubuntu/Debian VPS without Docker, use <strong>PM2</strong> to ensure the application restarts automatically upon server reboot or unexpected exceptions:
</p>
<pre><code># 1. Install PM2 globally
npm install -g pm2

# 2. Launch the application
pm2 start bot.js --name "cravey-bot"

# 3. Configure PM2 systemd daemon to survive server reboots
pm2 startup
pm2 save</code></pre>

<div class="page-break"></div>

<!-- CHAPTER 6 -->
<h1 class="chapter">Chapter 6: WhatsApp Connection & Multi-Session Pairing Manual</h1>

<h2>6.1 Overview of Connection Methods</h2>
<p>
Cravey Crust provides two independent pairing protocols through its modern web dashboard (accessible at <code>http://localhost:3000</code>).
</p>

<h2>6.2 Method 1: The 8-Digit Pairing Code (Recommended)</h2>
<p>
The pairing code method is the fastest, cleanest, and most reliable way to link a restaurant phone number. It requires only one device and does not involve pointing a camera at a screen.
</p>

<div class="diagram-box">
Step 1: Open Dashboard (http://localhost:3000)
Step 2: Enter WhatsApp Number (e.g. 923001234567) ──► Click "Get Pairing Code"
Step 3: Server generates 8-digit alphanumeric token (e.g. "K7WP-92LA")
Step 4: On Phone: WhatsApp ➜ Linked Devices ➜ Link a Device ➜ "Link with phone number instead"
Step 5: Enter the 8-digit code ──► Immediate Secure Pairing & Session Persistence
</div>

<ol>
  <li>Access the dashboard at <code>http://localhost:3000</code>.</li>
  <li>In the <strong>WhatsApp Connection Hub</strong> card, select <strong>"Pairing Code Mode"</strong>.</li>
  <li>Enter the phone number hosting the restaurant WhatsApp account, including country code (e.g., <code>923001234567</code> for Pakistan). Do not enter <code>+</code> or dashes.</li>
  <li>Click <strong>Request Pairing Code</strong>. Within 2-3 seconds, an 8-character code will appear in large letters.</li>
  <li>Open WhatsApp on the target smartphone. Tap the three dots (Android) or Settings (iPhone) ➜ <strong>Linked Devices</strong> ➜ <strong>Link a Device</strong>.</li>
  <li>Tap <strong>"Link with phone number instead"</strong> at the bottom of the camera screen.</li>
  <li>Enter the 8 characters. The socket will authenticate immediately, and the terminal will output: <code>[WhatsApp] Connection established successfully!</code></li>
</ol>

<h2>6.3 Method 2: High-Resolution QR Code Scanner</h2>
<p>
If you prefer traditional QR pairing:
</p>
<ol>
  <li>Select <strong>"QR Code Mode"</strong> on the dashboard or watch your server terminal.</li>
  <li>A high-resolution QR code will render both in the web browser and directly inside the terminal window via ASCII graphics.</li>
  <li>Open WhatsApp ➜ <strong>Linked Devices</strong> ➜ <strong>Link a Device</strong> ➜ Point the camera at the code.</li>
</ol>

<h2>6.4 Session Security & Persistence Mechanics</h2>
<div class="callout warning">
  <div class="callout-title">CRITICAL SECURITY NOTICE</div>
  All encryption keys, ratchet tokens, and device credentials are saved inside the local <code>auth/</code> directory. This directory is strictly included in <code>.gitignore</code>. <strong>Never copy, zip, or commit the <code>auth/</code> directory to public version control</strong>, as anyone with access to these files can impersonate your WhatsApp account.
</div>
<p>
The platform features an automated <strong>Socket Reconnection & Ratchet Healing Daemon</strong>. If the server loses internet connectivity or restarts, it re-reads the credentials from <code>auth/</code> and restores connection without requiring staff to re-scan or enter codes again.
</p>

<div class="page-break"></div>

<!-- CHAPTER 7 -->
<h1 class="chapter">Chapter 7: Kitchen & Administration Web Dashboard Manual</h1>

<h2>7.1 Accessing the Dashboard</h2>
<p>
Open your web browser and navigate to:
</p>
<pre><code>http://&lt;your-server-ip&gt;:3000</code></pre>
<p>
Log in with the credentials defined in your <code>.env</code> file (Default: User: <code>admin</code>, Password: <code>xortlogix</code>).
</p>

<h2>7.2 The Kitchen Kanban Pipeline</h2>
<p>
The order fulfillment workflow is visualized through an interactive Kanban board designed for kitchen display systems (KDS):
</p>

<table>
  <thead>
    <tr>
      <th>Pipeline Stage</th>
      <th>Database Status</th>
      <th>Kitchen Action Required</th>
      <th>Automated Customer WhatsApp Trigger</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>1. New Incoming</strong></td>
      <td><code>PENDING</code></td>
      <td>Chef reviews items; clicks <strong>"Accept Order"</strong>.</td>
      <td><em>"Aapka order kitchen ne accept kar liya hai! Preparing..."</em></td>
    </tr>
    <tr>
      <td><strong>2. In Kitchen</strong></td>
      <td><code>PREPARING</code></td>
      <td>Ovens & fryers working; items being packed into boxes.</td>
      <td>Customer can check live countdown via <code>.status</code>.</td>
    </tr>
    <tr>
      <td><strong>3. Out for Delivery</strong></td>
      <td><code>OUT_FOR_DELIVERY</code></td>
      <td>Handed to dispatch rider; rider phone number attached.</td>
      <td><em>"Aapka order rider ko hand over ho chuka hai! On the way."</em></td>
    </tr>
    <tr>
      <td><strong>4. Fulfilled</strong></td>
      <td><code>DELIVERED</code></td>
      <td>Rider confirms payment received & order handed over.</td>
      <td><em>"Mubarak ho! Order deliver ho chuka hai. Feedback dein!"</em></td>
    </tr>
    <tr>
      <td><strong>5. Cancelled</strong></td>
      <td><code>CANCELLED</code></td>
      <td>Item out of stock or fake customer details detected.</td>
      <td><em>"Maazrat! Aapka order cancel kar diya gaya hai."</em></td>
    </tr>
  </tbody>
</table>

<h2>7.3 Catalog, Variants & Deal Management</h2>
<p>
Under the <strong>"Menu & Deals"</strong> tab, restaurant managers can make live menu adjustments:
</p>
<ul>
  <li><strong>Instant Stock Toggle:</strong> Click on any pizza, burger, or beverage to toggle its <code>isAvailable</code> flag. The in-memory cache updates instantly. If an item is disabled, the AI agent will immediately refuse to sell it on WhatsApp.</li>
  <li><strong>Variant Matrices:</strong> Define sizes (Small, Regular, Large, Jumbo) and crust types (Thin Crust, Stuffed Crust, Pan Crust) with respective price increments.</li>
  <li><strong>Combo Deals Engine:</strong> Create deals with bundled rules (e.g., <em>"Deal 1 = 1 Large Pizza + 2 Drinks for Rs. 1450"</em>).</li>
</ul>

<h2>7.4 Live AI Prompt & Persona Tuner</h2>
<p>
Under the <strong>"AI Settings"</strong> tab, managers can customize the bot's behavior in real time:
</p>
<ul>
  <li><strong>Personality Tuning:</strong> Modify the tone from friendly Pakistani Roman Urdu (<em>"Burger Raja"</em>) to formal English.</li>
  <li><strong>Special Announcement Injections:</strong> Add temporary rules (e.g., <em>"Aj barish ki wajah se delivery mein 15 minute extra lag sakte hain"</em>). The AI will immediately integrate this notice into conversational replies without restarting the Node.js server.</li>
</ul>

<div class="page-break"></div>

<!-- CHAPTER 8 -->
<h1 class="chapter">Chapter 8: Relational Database Schema & Prisma ORM Blueprint</h1>

<h2>8.1 Entity Relationship Diagram (ERD) Overview</h2>

<div class="diagram-box">
 ┌──────────────┐         1:N         ┌──────────────┐         1:N         ┌──────────────┐
 │   Customer   │ ──────────────────► │    Order     │ ──────────────────► │  OrderItem   │
 └──────────────┘                     └──────────────┘                     └──────────────┘
        │ 1:1                                                                     │
        ▼                                                                         ▼
 ┌──────────────┐         1:N         ┌──────────────┐                     ┌──────────────┐
 │     Cart     │ ──────────────────► │   CartItem   │                     │   MenuItem   │
 └──────────────┘                     └──────────────┘                     └──────────────┘
                                                                                  │ 1:N
                                                                                  ▼
                                                                           ┌──────────────┐
                                                                           │   Variant    │
                                                                           └──────────────┘
</div>

<h2>8.2 Core Prisma Data Models (prisma/schema.prisma)</h2>

<h3>1. Order & OrderItem Entities</h3>
<pre><code>model Order {
  id              String        @id @default(uuid())
  orderNumber     String        @unique // e.g. "CRV-8942"
  customerId      String
  customer        Customer      @relation(fields: [customerId], references: [id])
  status          OrderStatus   @default(PENDING) // PENDING, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED
  totalAmount     Decimal       @db.Decimal(10, 2)
  deliveryFee     Decimal       @default(0.00) @db.Decimal(10, 2)
  deliveryAddress String
  deliveryAreaId  String?
  deliveryArea    DeliveryArea? @relation(fields: [deliveryAreaId], references: [id])
  paymentMethod   PaymentMethod @default(COD) // COD, JAZZCASH, EASYPAISA
  paymentStatus   PaymentStatus @default(UNPAID)
  items           OrderItem[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model OrderItem {
  id          String    @id @default(uuid())
  orderId     String
  order       Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  menuItemId  String
  menuItem    MenuItem  @relation(fields: [menuItemId], references: [id])
  variantId   String?
  variant     Variant?  @relation(fields: [variantId], references: [id])
  quantity    Int       @default(1)
  unitPrice   Decimal   @db.Decimal(10, 2)
  totalPrice  Decimal   @db.Decimal(10, 2)
}</code></pre>

<h3>2. Customer & In-Flight Cart Entities</h3>
<pre><code>model Customer {
  id            String    @id @default(uuid())
  phoneNumber   String    @unique // WhatsApp Phone with country code
  fullName      String?
  savedAddress  String?
  isHandover    Boolean   @default(false)
  cart          Cart?
  orders        Order[]
  createdAt     DateTime  @default(now())
}

model Cart {
  id          String     @id @default(uuid())
  customerId  String     @unique
  customer    Customer   @relation(fields: [customerId], references: [id], onDelete: Cascade)
  items       CartItem[]
  updatedAt   DateTime   @updatedAt
}</code></pre>

<div class="page-break"></div>

<!-- CHAPTER 9 -->
<h1 class="chapter">Chapter 9: Complete REST API & System Probes Reference</h1>

<h2>9.1 Authentication & Request Headers</h2>
<p>
Administrative endpoints located under <code>/api/admin/*</code> require an authenticated session or an authorization bearer token matching the configured secret.
</p>

<h2>9.2 Key Administrative Endpoints</h2>
<table>
  <thead>
    <tr>
      <th>HTTP Method</th>
      <th>Endpoint Route</th>
      <th>Description</th>
      <th>Sample Response / Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>GET</code></td>
      <td><code>/api/admin/orders</code></td>
      <td>Lists all active orders with optional <code>?status=PENDING</code> filter.</td>
      <td><code>200 OK [{"id":"uuid","orderNumber":"CRV-101",...}]</code></td>
    </tr>
    <tr>
      <td><code>PATCH</code></td>
      <td><code>/api/admin/orders/:id/status</code></td>
      <td>Updates order state & triggers customer WhatsApp alert.</td>
      <td><code>200 OK {"success":true,"newStatus":"PREPARING"}</code></td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/api/admin/menu</code></td>
      <td>Fetches complete catalog with categories & pricing variants.</td>
      <td><code>200 OK [{"id":"m1","name":"Fajita Pizza",...}]</code></td>
    </tr>
    <tr>
      <td><code>POST</code></td>
      <td><code>/api/admin/menu</code></td>
      <td>Creates a new pizza, burger, or beverage item.</td>
      <td><code>201 Created {"success":true,"itemId":"uuid"}</code></td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/api/admin/deals</code></td>
      <td>Retrieves active combo bundle deals.</td>
      <td><code>200 OK [{"dealName":"Deal 1","price":750,...}]</code></td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/api/admin/prompt</code></td>
      <td>Returns current AI persona system prompt.</td>
      <td><code>200 OK {"systemPrompt":"You are Burger Raja..."}</code></td>
    </tr>
    <tr>
      <td><code>POST</code></td>
      <td><code>/api/admin/prompt</code></td>
      <td>Hot-reloads AI prompt with zero server downtime.</td>
      <td><code>200 OK {"success":true,"message":"Prompt reloaded"}</code></td>
    </tr>
    <tr>
      <td><code>GET</code></td>
      <td><code>/health</code></td>
      <td>Liveness probe checking DB, memory & WhatsApp socket.</td>
      <td><code>200 OK {"status":"healthy","db":"connected"}</code></td>
    </tr>
  </tbody>
</table>

<div class="page-break"></div>

<!-- CHAPTER 10 -->
<h1 class="chapter">Chapter 10: Bot Commands, Production Hardening & Troubleshooting</h1>

<h2>10.1 WhatsApp Bot Commands Reference</h2>
<table>
  <thead>
    <tr>
      <th>Command</th>
      <th>Permission</th>
      <th>Functional Behavior</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>.menu</code></td>
      <td>Public (All)</td>
      <td>Prints the restaurant's complete categorized menu directly in chat.</td>
    </tr>
    <tr>
      <td><code>.status</code></td>
      <td>Public (All)</td>
      <td>Queries the customer's most recent active order and prints real-time status.</td>
    </tr>
    <tr>
      <td><code>.handover</code></td>
      <td>Public (All)</td>
      <td>Pauses the AI agent and alerts human kitchen staff that assistance is requested.</td>
    </tr>
    <tr>
      <td><code>.takeover</code></td>
      <td>Admin / Owner</td>
      <td>Unpauses the AI agent and resumes automated order handling.</td>
    </tr>
    <tr>
      <td><code>.ping</code></td>
      <td>Admin / Owner</td>
      <td>Measures bot socket round-trip latency and prints current memory consumption.</td>
    </tr>
    <tr>
      <td><code>.mute</code> / <code>.unmute</code></td>
      <td>Admin</td>
      <td>Temporarily silences bot activity in a designated chat or group.</td>
    </tr>
    <tr>
      <td><code>.sticker</code></td>
      <td>Public (All)</td>
      <td>Converts an attached photo or 7-second video into a WhatsApp sticker via FFmpeg.</td>
    </tr>
    <tr>
      <td><code>.vv</code></td>
      <td>Owner Only</td>
      <td>Extracts and recovers view-once (single-view) photos and videos for audit.</td>
    </tr>
  </tbody>
</table>

<h2>10.2 Production Hardening & Operational Best Practices</h2>
<ol>
  <li><strong>SSL Termination with Nginx Reverse Proxy:</strong> Never expose port 3000 directly to the public internet. Deploy Nginx in front of the application with Let's Encrypt SSL certificates.</li>
  <li><strong>Automated Database Backups:</strong> Schedule a daily cron job executing <code>pg_dump</code> to back up customer order history to offsite storage:
  <pre><code>0 3 * * * pg_dump -U cravey cravey_crust > /backups/cravey_$(date +\%F).sql</code></pre></li>
  <li><strong>WhatsApp Account Warmup:</strong> If linking a brand-new SIM card or WhatsApp account, do not blast 500 promotional broadcast messages on day one. Allow the account to warm up organically over 5-7 days with normal conversations to prevent WhatsApp automated anti-spam flags.</li>
</ol>

<h2>10.3 Troubleshooting & Frequently Encountered Issues</h2>

<div class="callout important">
  <div class="callout-title">ISSUE 1: Port 3000 Already In Use (EADDRINUSE)</div>
  <p><strong>Cause:</strong> A previous Node.js instance or another service is occupying port 3000.</p>
  <p><strong>Remedy:</strong> On Linux: <code>lsof -i :3000 | awk 'NR>1 {print $2}' | xargs kill -9</code>.<br>
  On Windows: <code>Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process</code>, or modify <code>PORT=3001</code> in <code>.env</code>.</p>
</div>

<div class="callout warning">
  <div class="callout-title">ISSUE 2: WhatsApp Session Disconnected / Logged Out</div>
  <p><strong>Cause:</strong> The host phone remained disconnected from the internet for over 14 days, or the user manually selected "Log out" from Linked Devices.</p>
  <p><strong>Remedy:</strong> Delete the stale authentication folder: <code>rm -rf auth/</code> and re-pair using the 8-digit pairing code on the web dashboard.</p>
</div>

<div class="callout tip">
  <div class="callout-title">ISSUE 3: AI Quota Rate Limit (HTTP 429)</div>
  <p><strong>Cause:</strong> High traffic volume exceeded the free-tier requests per minute (RPM) for a single Gemini API key.</p>
  <p><strong>Remedy:</strong> Add 2-3 additional Gemini API keys in <code>.env</code> under <code>GEMINI_API_KEYS="key1,key2,key3"</code> or configure <code>DEEPSEEK_API_KEYS</code> as fallback.</p>
</div>

<hr style="margin-top: 40px; border: 0; border-top: 1px solid #cbd5e1;">
<div style="text-align: center; font-size: 9pt; color: #64748b; margin-top: 20px;">
  <strong>Cravey Crust Automation Platform</strong> — Complete Operational Manual<br>
  Engineered for High-Volume Hospitality & Conversational Commerce
</div>

</body>
</html>
"""

output_pdf = "Cravey_Crust_Platform_Manual.pdf"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.set_content(html_content, wait_until="networkidle")
    page.pdf(
        path=output_pdf,
        format="A4",
        print_background=True,
        margin={
            "top": "20mm",
            "bottom": "20mm",
            "left": "18mm",
            "right": "18mm"
        },
        display_header_footer=True,
        header_template='<div style="font-size: 8pt; font-family: sans-serif; color: #94a3b8; width: 100%; text-align: right; padding-right: 20mm;">Cravey Crust Platform Manual & Architectural Blueprint</div>',
        footer_template='<div style="font-size: 8pt; font-family: sans-serif; color: #94a3b8; width: 100%; text-align: center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    )
    browser.close()

print(f"PDF successfully generated: {os.path.abspath(output_pdf)}")
