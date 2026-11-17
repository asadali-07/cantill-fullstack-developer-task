# Cantill PR-to-PO Assistant — Key Decisions & Assumptions

This document records the architectural decisions, operational assumptions, formula definitions, and trade-offs made during the implementation of the Cantill PR-to-PO Assistant.

---

## 1. Mathematical Formulas & Scoring Models

### 1.1 Preferred Supplier Ranking Formula

When determining the preferred suppliers for an item (e.g. for generating `preferred_suppliers.csv` or selecting vendors for RFQ/RFP), suppliers are scored using a normalized multi-factor model with the following weights:

$$\text{Total Score} = 0.25 \cdot S_{\text{recency}} + 0.20 \cdot S_{\text{frequency}} + 0.20 \cdot S_{\text{contract}} + 0.20 \cdot S_{\text{ontime}} + 0.15 \cdot S_{\text{quality}}$$

#### Factor Definitions:
1. **Recency ($S_{\text{recency}}$ — Weight: 0.25)**:
   Measures how recently the supplier was awarded a Purchase Order for the item relative to the evaluation date (default: Nov 1, 2026):
   $$S_{\text{recency}} = \max\left(0, 1 - \frac{\text{Days Since Last PO}}{365}\right)$$
   Suppliers with no POs within the last 365 days receive $0.0$.

2. **Transaction Frequency ($S_{\text{frequency}}$ — Weight: 0.20)**:
   Normalized count of POs fulfilled by the supplier for the item in the preceding 365 days:
   $$S_{\text{frequency}} = \min\left(1.0, \frac{\text{PO Count}}{5}\right)$$

3. **Active Contract Relationship ($S_{\text{contract}}$ — Weight: 0.20)**:
   Binary indicator of an existing contractual agreement:
   $$S_{\text{contract}} = \begin{cases} 1.0 & \text{if supplier has an active rate contract covering the item} \\ 0.0 & \text{otherwise} \end{cases}$$

4. **On-Time Delivery Performance ($S_{\text{ontime}}$ — Weight: 0.20)**:
   Historical reliability metric:
   $$S_{\text{ontime}} = \frac{\text{Deliveries On or Before Need-By Date}}{\text{Total Completed Deliveries}}$$
   If no historical delivery records exist, defaults to category average ($0.85$).

5. **Quality Acceptance Rate ($S_{\text{quality}}$ — Weight: 0.15)**:
   Historical inspection metric:
   $$S_{\text{quality}} = 1.0 - \left(\frac{\text{Rejected Quantity}}{\text{Total Received Quantity}}\right)$$

#### Tie-Breaking & Category Backfill:
- If suppliers have identical composite scores, ties are broken by lower contracted/historical unit price.
- If fewer than 3 suppliers have historical transactions for an item, active suppliers registered under the item's category are appended with a baseline discovery score to ensure sufficient vendor coverage for Sourcing RFQs.

---

## 2. Core Operational Assumptions

### 2.1 Anti-Splitting Clubbing Windows
- **Creation Window**: Requisitions for the exact same item code at the exact same manufacturing plant (`PUN1` or `CHN1`) created within **14 calendar days** of each other are grouped into a single consolidated requirement.
- **Need-By Tolerance**: To ensure operational feasibility on the shop floor, requisitions are only grouped if their need-by dates fall within $\pm \mathbf{7 \text{ days}}$ of each other.
- **NEW Items**: Requisitions classified as `NEW` (uncataloged items without a matched Item Master code) are **never clubbed together**. Clubbing disparate custom descriptions could result in heterogeneous, un-sourcable requisition bundles.

### 2.2 Contract Ceiling Tracking & Exhaustion
- Rate contracts specify an aggregate monetary ceiling (`ceiling_value`).
- When processing requisitions sequentially, each allocation against a rate contract increments its consumed spend ledger.
- If a requisition's total value would cause the contract to exceed its remaining ceiling balance:
  - The contract is declared **exhausted** for this requirement.
  - The requirement routes to competitive bidding (`SOURCING_RFQ` per Clause 5.2/5.5).
  - **Price Valuation Assumption**: Even though the ceiling is exhausted, the contracted rate is retained as the baseline reference price for calculating requirement threshold values.

### 2.3 Handling PDF-Only Contracts
- Contracts `RC-2026-031` (Pneumatic Point) and `RC-2026-033` (Infoline Systems) are present exclusively as PDF legal agreements in `contracts/` and not listed in the initial `contract_register.csv`.
- **Decision**: The system integrates text extraction and Schedule A table parsing for these agreements, registering them seamlessly into the active contract ledger with their respective items (`ITM-1036`, `ITM-1037`, `ITM-1039` for Pneumatic Point; `ITM-1056`, `ITM-1057` for Infoline Systems).

### 2.4 Handling Batch Edge Cases
1. **Quantity = 0 (`PR-26-00172`)**:
   - Requisitions with a quantity of zero or negative represent data-entry errors.
   - **Decision**: Flagged with route `INVALID_PR` and assigned policy rationale `"Rule 1.2: Invalid quantity (0). Routed for requester clarification"`.
2. **Invalid Plant Code (`PR-26-00173` — Plant `PUN2`)**:
   - Corvo operates only two authorized plants: `PUN1` (Pune) and `CHN1` (Chennai).
   - **Decision**: Routed to buyer intervention under `INVALID_PLANT` to prevent unauthorized procurement against decommissioned or invalid locations.

### 2.5 PO Consolidation Window
- Requisitions resulting in Purchase Orders for the same supplier and plant created within a **24-hour window** are consolidated into a unified Purchase Order group, minimizing administrative and logistics costs.

---

## 3. Engineering Trade-Offs

| Decision | Chosen Alternative | Rejected Alternative | Rationale |
|---|---|---|---|
| **Contract Ceiling State Management** | In-Memory Transactional Ledger | Synchronous Database Writes per Line | In-memory ledger processes 186 lines in $<2000\text{ms}$ while ensuring deterministic reproducibility for blind test re-runs. Final consolidated state persists after batch completion. |
| **Policy Amendment Parsing** | Hybrid: Gemini 2.5 AI + Deterministic Regex Fallback | Pure Regex Parser OR Pure LLM | Gemini handles nuanced natural language phrasing; deterministic regex guarantees uninterrupted functionality even if cloud network or API quotas are constrained. |
| **Frontend Architecture** | Single-Page React (Vite + Tailwind) | Multi-Page MPA / Server-Rendered | Provides responsive table filtering across 186 rows, inline buyer overrides, and fluid real-time chat with zero page reloads. |
| **Policy Storage** | Versioned Document Model in MongoDB | Static JSON Config File | Storing policies as versioned documents enables real-time amendments through the UI without requiring code deployments or container restarts. |

---

## 4. Verification Against Worked Examples

| Test Scenario | Reference | Engine Output | Status |
|---|---|---|---|
| Contract PO lookup | Ex 1 (PR-26-00019/1) | `CONTRACT_PO` (S013, ₹202.2) | ✅ PASS |
| PDF-only contract resolution | Ex 2 (PR-26-00045/1) | `CONTRACT_PO` (S021, RC-2026-031) | ✅ PASS |
| Contract ceiling exhaustion | Ex 3 (PR-26-00004 & 00026) | `SOURCING_RFQ` | ✅ PASS |
| Multi-contract lowest rate | Ex 4 (PR-26-00034/1) | `CONTRACT_PO` (S007) | ✅ PASS |
| Split PR clubbing | Ex 5 (PR-26-00146, 144, 145) | 1 Clubbed Requirement (`SPOT_PO`) | ✅ PASS |
| Multi-plant anti-clubbing | Ex 6 (PR-26-00106 vs 00103) | 2 Distinct Requirements | ✅ PASS |
| Fuzzy description matching | Ex 7 (PR-26-00088 "hyd hose") | Matched `ITM-1035` (`SPOT_PO`) | ✅ PASS |
| Emergency PO fast-track | Ex 8 (PR-26-00059) | `EMERGENCY_PO` (S014, ₹315,000) | ✅ PASS |
| Non-emergency RFQ | Ex 9 (PR-26-00089 CMM service) | `SOURCING_RFQ` | ✅ PASS |
| Uncataloged / never bought | Ex 10 (PR-26-00050) | `SOURCING_RFQ` | ✅ PASS |
| High value RFP threshold | Ex 11 (PR-26-00100 $\ge ₹10\text{L}$) | `SOURCING_RFP` | ✅ PASS |
| Capex item routing | Ex 12 (PR-26-00047 EOT crane) | `CAPEX_SOURCING` (5 quotes) | ✅ PASS |
| Uncataloged NEW item | Ex 13 (PR-26-00170 Water purifier) | `NEW_ITEM_SOURCING` | ✅ PASS |
| PO consolidation within 24h | Ex 14 (PR-26-00034 & 00031) | Consolidated Under Single PO Group | ✅ PASS |
