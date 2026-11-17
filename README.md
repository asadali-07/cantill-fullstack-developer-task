# Cantill PR-to-PO Assistant

An intelligent, full-stack procurement automation web application built for Corvo Engineering. The system ingests Purchase Requisitions (PRs) via interactive AI chat or bulk CSV uploads, applies a data-driven procurement policy (Corvo Policy v5.0), and deterministically routes requirements to Purchase Orders or Sourcing Requests.

Policy amendments are handled dynamically through the user interface using Gemini 2.5 AI — decisions update instantly without code changes or server redeployments.

---

## 🚀 Key Features

1. **💬 Conversational PR Intake (20%)**:
   - Natural language requisition creation powered by Google Gemini 2.5 Flash.
   - Grounded item catalog matching, abbreviation expansion (`brg` → `bearing`, `hyd` → `hydraulic`), and plant validation.
   - Real-time confirmation cards and synchronous Decision Engine routing.

2. **⚙️ Corvo Core Decision Engine (30%)**:
   - **Anti-Splitting Clubbing**: 14-day rolling window with $\pm 7$-day need-by tolerance.
   - **Dynamic Ceiling Tracking**: Tracks rate contract commitments across both registered and PDF agreements (`RC-2026-031`, `RC-2026-033`).
   - **Price Valuation Waterfall**: Rate Contract $\to$ Historical PO $\to$ Master Catalog $\to$ Requester Estimate.
   - **Preferred Supplier Ranking**: 5-factor weighted formula (Recency 0.25, Frequency 0.20, Contract 0.20, On-Time 0.20, Quality 0.15).
   - **PO Consolidation**: Merges eligible POs within a 24-hour window.
   - Validated against **14/14 worked examples** and **3/3 preferred supplier rankings** from the task kit.

3. **🛡️ Policy-as-Data Engine (15%)**:
   - Zero-code policy updates via natural language or PDF amendment memos.
   - AI diff preview with before-and-after threshold comparisons.
   - Version history management and one-click rollback/activation.

4. **📋 Buyer Workspace (15%)**:
   - Bulk PR batch CSV upload and processing (`sample_pr_batch.csv`).
   - Filterable & searchable decision table with route badges and policy rationale.
   - Mandatory justification buyer override workflow (`POST /api/buyer/override`).
   - Standardized CSV export for blind testing.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, Axios, React Hot Toast
- **Backend**: Node.js, Express, TypeScript, Mongoose 8, CSV-Parse/Stringify, PDF-Parse
- **Database**: MongoDB Atlas Cloud Database
- **AI Model**: Google Gemini API (`gemini-2.5-flash`)
- **Containerization**: Docker & Docker Compose with multi-stage builds and Nginx

---

## 🏃 Local Setup & Running

### Prerequisites
- Node.js v20+
- npm v10+
- A MongoDB database (MongoDB Atlas cloud URI or local MongoDB)
- Google Gemini API Key

### 1. Environment Configuration
Copy `.env.example` to `.env` in the root directory:
```bash
cp .env.example .env
```
Ensure `.env` contains your active connection credentials:
```env
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/cantill?retryWrites=true&w=majority
GEMINI_API_KEY=your-gemini-api-key
NODE_ENV=development
```

### 2. Install Dependencies
```bash
# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
cd ..
```

### 3. Seed Master Data & Corvo Policy v5.0
```bash
cd server
npm run seed
cd ..
```
*Seeds 73 master items, 48 suppliers, 2 plants, 468 PO history records, 10 registered contracts + 2 PDF contracts, and initial Policy v5.0.*

### 4. Start Development Servers
In two separate terminals:

```bash
# Terminal 1: Backend API (runs on http://localhost:5000)
cd server
npm run dev
```

```bash
# Terminal 2: Frontend Client (runs on http://localhost:5173)
cd client
npm run dev
```

Visit **`http://localhost:5173`** in your browser.

---

## 🐳 Running with Docker

Run the complete multi-container stack with a single command:
```bash
docker-compose up --build
```
- Client (Nginx SPA): `http://localhost` (Port 80)
- Backend REST API: `http://localhost:5000`

---

## 🧪 Verification & Blind Test Instructions

### Verify Core Decision Engine:
```bash
cd server
npx tsx src/engine/testEngine.ts
```
Expected output:
- **186 PR lines processed** into **151 clubbed requirements** in $<2000\text{ms}$.
- **14 / 14 worked example tests passed**.
- **3 / 3 preferred supplier lists verified**.

### Blind Test Execution (Thu Nov 19):
1. **Run 1:** Open `/workspace` in the app, upload the test PR batch CSV, click **Export Decisions CSV**, and name it `yourname__run1.csv`.
2. **Amend Policy:** Navigate to `/policy`, paste the amendment text or upload the amendment PDF, click **Preview Amendment Diff**, review the AI-extracted changes, and click **Approve & Activate**.
3. **Run 2:** Return to `/workspace`, re-run the batch, click **Export Decisions CSV**, and name it `yourname__run2.csv`.
4. **Preferred Suppliers:** Click **Export Preferred Suppliers** on `/workspace` and name it `yourname__preferred.csv`.
5. Save all three files inside the `submission/` directory.

---

## 📚 Documentation

- [APPROACH.md](APPROACH.md) — Architectural overview, pipeline mechanics, and AI integration design.
- [DECISIONS.md](DECISIONS.md) — Operational assumptions, mathematical formulas (supplier ranking weights), and trade-offs.
