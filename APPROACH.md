# Cantill PR-to-PO Assistant — Architectural Approach

## 1. System Overview

Cantill is an intelligent, full-stack procurement automation platform built for Corvo Engineering. It transforms unstructured and semi-structured Purchase Requisitions (PRs) into policy-compliant procurement actions: either automated Purchase Orders (POs) or structured Sourcing Requests (RFQs/RFPs).

The core tenet of the system is **Policy-as-Data**: procurement policy (Corvo Policy v5.0 and future amendments) is stored as dynamic data within MongoDB rather than hardcoded in application logic. When procurement leadership amends policy thresholds or rules through the user interface, the system interprets the memo using Gemini 3.1 AI, computes an exact diff, updates the active policy record, and alters all downstream routing decisions without code changes or redeployments.

---

## 2. Technology Stack & Tools Used

| Layer | Technologies | Justification |
|---|---|---|
| **Frontend** | React 19, Vite, Tailwind CSS, Lucide Icons, Axios | High performance, instant compilation, modern ergonomic UI with responsive data tables, KPI metrics, and live chat. |
| **Backend** | Node.js, Express, TypeScript | Type-safe REST API with robust streaming support for CSV processing and multipart PDF ingestion. |
| **Database** | MongoDB Atlas (Cloud) | Flexible document store capable of modeling both normalized transactional data (Items, Contracts, Suppliers) and dynamic JSON rule schemas (Policy-as-Data). |
| **AI Provider** | Google Gemini API (`gemini-3.1-flash-lite`) | State-of-the-art reasoning model for conversational catalog matching, requirement validation, and zero-shot policy amendment extraction. |
| **Parsing & Export** | `csv-parse`, `csv-stringify`, `pdf-parse` | Robust CSV reading/generation and PDF contract text extraction. |
| **Runtime Environment** | Node.js v20+, Vite Dev Server | Fast local development and direct production serving without container overhead. |

---

## 3. High-Level Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                 USER INTERFACES                                   |
|                                                                                   |
|  +--------------------+   +---------------------+   +--------------------------+  |
|  |  💬 Chat Intake    |   | 📋 Buyer Workspace  |   | 🛡️ Policy-as-Data Center |  |
|  |  (Conversational)  |   | (Batch CSV & Table) |   | (Gemini Diff & Activate) |  |
|  +---------+----------+   +----------+----------+   +------------+-------------+  |
+------------|-------------------------|---------------------------|----------------+
             |                         |                           |
             v                         v                           v
+-----------------------------------------------------------------------------------+
|                               EXPRESS REST API                                    |
|                                                                                   |
|  /api/chat        /api/process-batch        /api/buyer/*        /api/policy/*     |
|  /api/suppliers   /api/contracts            /api/health                           |
+--------------------------------------+--------------------------------------------+
                                       |
+--------------------------------------v--------------------------------------------+
|                       CORVO CORE DECISION ENGINE                                  |
|                                                                                   |
|  1. Item Matcher        -->  Abbrev expansion (brg->bearing), token scoring       |
|  2. Anti-Splitting      -->  Club same item+plant in 14d window, ±7d tolerance   |
|  3. Contract Tracker    -->  RC rate lookup, dynamic ceiling consumption ledger   |
|  4. Price Valuator      -->  Waterfall: Contract -> Hist PO -> Master -> Est     |
|  5. Supplier Ranker     -->  5-factor weighted formula (0.25/0.20/0.20/0.20/0.15) |
|  6. Decision Router     -->  Clauses: 1.2 -> 5.1 -> 5.2 -> 5.3 -> 5.4 -> 5.5/5.6  |
|  7. PO Consolidator     -->  Merges orders: same supplier + plant within 24h      |
+-------------------+------------------------------------------+--------------------+
                    |                                          |
                    v                                          v
+--------------------------------------+   +----------------------------------------+
|           MONGODB ATLAS              |   |           GOOGLE GEMINI API            |
|                                      |   |                                        |
|  - Items (73 master items)           |   |  - gemini-3.1-flash-lite               |
|  - Suppliers (48 vendors)            |   |  - System instruction item grounding   |
|  - Plants (PUN1, CHN1)               |   |  - Multi-turn conversation state       |
|  - Contracts & Lines (12 contracts)  |   |  - Zero-code policy amendment parser   |
|  - PO History (468 historical POs)   |   |                                        |
|  - Policy Versions (v5.0, v5.1...)   |   |                                        |
|  - Requisitions & Decisions          |   |                                        |
+--------------------------------------+   +----------------------------------------+
```

---

## 4. Decision Engine Pipeline Details

The decision engine is implemented as a deterministic, pure-function pipeline in `server/src/engine/`:

### Step 1: Item Matching (`matcher.ts`)
1. Handles free-text inputs, missing item codes, and abbreviations.
2. Expands domain abbreviations (`brg` → `bearing`, `hyd` → `hydraulic`, `pneu` → `pneumatic`, `sol valve` → `solenoid valve`).
3. Cleans noise terms (`mm`, `nos`, `standard`, `grade`).
4. Scores matches using token overlap and character similarity against the Item Master catalog.
5. If no item exceeds the confidence threshold, flags as a `NEW` catalog item without hallucinating item codes.

### Step 2: Anti-Splitting Clubbing (`clubber.ts`)
1. Groups requisitions for the same item at the same plant created within a rolling 14-day window.
2. Respects a need-by tolerance of $\pm 7$ days.
3. Anti-splitting logic ensures requesters cannot bypass PO authorization thresholds by submitting multiple small PRs.
4. Items flagged as `NEW` are never clubbed to avoid grouping heterogeneous uncataloged items.

### Step 3: Dynamic Contract Ceiling Tracking (`contracts.ts`)
1. Ingests all active rate contracts from both the database register and PDF agreements (e.g., RC-2026-031 for Pneumatic Point and RC-2026-033 for Infoline Systems).
2. Maintains an in-memory transactional consumption ledger.
3. When multiple contracts exist for the same item at the same plant, selects the lowest contracted rate.
4. If a requisition exceeds the remaining contract ceiling balance, the contract is bypassed and routed to competitive bidding (RFQ) per Clause 5.2.

### Step 4: Price Valuation Waterfall (`valuator.ts`)
Determines the unit price for evaluating requirement value thresholds:
1. **Active Rate Contract Price**: Lowest applicable rate contract if ceiling remains.
2. **Exhausted Contract Price**: If ceiling is exhausted, the contract rate still sets the reference baseline.
3. **Historical PO Rate**: Most recent purchase order within the last 365 days from an `Active` supplier.
4. **Item Master Standard Price**: Baseline catalog price.
5. **Requester Estimated Price**: Utilized for `NEW` uncataloged items.

### Step 5: Supplier Ranking (`supplierRanker.ts`)
Ranks suppliers for items without an active rate contract using a 5-factor weighted formula:
- **Recency of purchase (365-day decay)**: Weight 0.25
- **Transaction Frequency (PO count)**: Weight 0.20
- **Existing Contract Relationship**: Weight 0.20
- **Historical On-Time Delivery Rate**: Weight 0.20
- **Quality Score (1.0 - rejection rate)**: Weight 0.15

If fewer than 3 suppliers have historical transactions for an item, active suppliers mapped to the item's category are appended to guarantee adequate competition.

### Step 6: Route Decision Waterfall (`decisionRules.ts`)
Applies Corvo Policy rules sequentially:
1. **Rule 1.2 / Edge Cases**: Invalid plants (not PUN1/CHN1) or zero/negative quantities routed to buyer review.
2. **Clause 5.1 (Capex Sourcing)**: Capital expenditure items always route to Capex Sourcing with 5 mandatory quotes regardless of value.
3. **Clause 5.2 (Contract PO)**: Valid rate contract with remaining ceiling routes directly to `CONTRACT_PO`.
4. **Clause 5.3 (Spot PO)**: Total requirement value $\le ₹200,000$ (or active policy limit) with an active supplier routes to `DIRECT_PO`.
5. **Clause 5.4 (Emergency PO)**: Urgency marked `Emergency` with value $\le ₹500,000$ routes to `DIRECT_PO`.
6. **Clause 5.5 (Sourcing RFQ)**: Non-emergency requirements between ₹200,000 and ₹1,000,000 route to `SOURCING_RFQ` (3 quotes required).
7. **Clause 5.6 (Sourcing RFP)**: Requirements $\ge ₹1,000,000$ route to `SOURCING_RFP` (5 quotes required).

### Step 7: PO Consolidation (`consolidator.ts`)
Requirements routed to POs for the same supplier and plant within a 24-hour creation window are consolidated under a single Purchase Order reference to reduce transaction overhead.

---

## 5. Gemini 3.1 Flash Lite AI Integration

### Module 1: Chat PR Intake (`chatService.ts`)
- **System Instruction Grounding**: The complete item master catalog and valid plant codes are injected into Gemini's system instructions.
- **Multi-Turn State Machine**: Progresses through `collecting` → `confirming` → `processing` → `submitted`.
- **Structured JSON Schema**: Prompts enforce structured JSON blocks (`confirm_pr`, `ask`, `submit`, `cancel`), preventing unstructured conversational drift.
- **Direct Submission**: Upon user confirmation, constructs a requisition object and executes the Corvo Decision Engine synchronously, returning the definitive route, supplier, and policy clause directly to the user.

### Module 2: Policy-as-Data Amendment Engine (`policyParser.ts`)
- **Natural Language Parsing**: Ingests policy amendment memos (PDF or text).
- **Rule Extraction**: Gemini parses numeric thresholds (`spot_po_limit`, `emergency_po_limit`, `rfq_limit`, `rfp_threshold`, `clubbing_window_days`, `vendor_counts`) and category overrides.
- **Diff Generation**: Compares extracted parameters against the active policy version and produces structured diff objects (`changed_rules`, `added_rules`, `removed_rules`).
- **One-Click Activation**: Upon buyer approval, stores the amendment as a new version document (e.g. `v5.1`) and updates the active pointer, altering subsequent engine evaluations without code modifications.

---

## 6. Verification & Quality Assurance

- **14/14 Worked Examples**: Rigorously validated via `server/src/engine/testEngine.ts`, matching every expected output in `Worked_Examples.pdf` (including edge cases, PDF-only contracts, ceiling exhaustion, and PO consolidation).
- **3/3 Preferred Supplier Rankings**: Verified against Worked Examples page 5 (`ITM-1048` → `[S029, S030]`, `ITM-1036` → `[S023, S022, S024]`, `ITM-1016` → `[S009, S010]`).
- **Blind Test Ready**: Dedicated CSV export utilities generate conformant output files (`yourname__run1.csv`, `yourname__run2.csv`, `yourname__preferred.csv`) adhering strictly to header naming conventions.
