import { ISupplier } from '../models/Supplier';
import { IPOHistory } from '../models/POHistory';
import { IContract } from '../models/Contract';
import { IContractLine } from '../models/ContractLine';

export interface RankedSupplier {
  supplier_id: string;
  name: string;
  status: string;
  pos_548d: number;
  recency: number; // 1.0 (<=90d), 0.5 (<=365d), 0.0 (>365d or none)
  has_contract: boolean;
  on_time_pct: number;
  quality_rating: number;
  reference_price: number | null;
  score: number;
  rank: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SupplierRankingWeights {
  order_recency?: number; // default 0.25
  order_frequency?: number; // default 0.20
  contract_history?: number; // default 0.20
  on_time_delivery?: number; // default 0.20
  quality_score?: number; // default 0.15
}

/**
 * Section 6: Preferred supplier list and ranking
 * Recalculated as of each requirement date.
 */
export function getPreferredSuppliers(
  itemCode: string,
  requirementDate: Date,
  suppliers: ISupplier[],
  poHistory: IPOHistory[],
  contracts: IContract[],
  contractLines: IContractLine[],
  weights?: SupplierRankingWeights
): RankedSupplier[] {
  const reqTime = requirementDate.getTime();
  const cutoff548 = reqTime - 548 * MS_PER_DAY;
  const cutoff365 = reqTime - 365 * MS_PER_DAY;
  const cutoff90 = reqTime - 90 * MS_PER_DAY;

  const wRecency = weights?.order_recency ?? 0.25;
  const wFreq = weights?.order_frequency ?? 0.20;
  const wContract = weights?.contract_history ?? 0.20;
  const wOnTime = weights?.on_time_delivery ?? 0.20;
  const wQuality = weights?.quality_score ?? 0.15;

  // Contracts covering the item that started on or before requirement date
  const itemContractLines = contractLines.filter((cl) => cl.item_code === itemCode);
  const itemContractIds = new Set(itemContractLines.map((cl) => cl.contract_id));

  const validItemContracts = contracts.filter(
    (c) => itemContractIds.has(c.contract_id) && c.start_date.getTime() <= reqTime
  );
  const contractSupplierIds = new Set(validItemContracts.map((c) => c.supplier_id));

  // POs for this item in the 548 days before requirement date
  const relevantPOs = poHistory.filter(
    (po) =>
      po.item_code === itemCode &&
      po.po_date.getTime() >= cutoff548 &&
      po.po_date.getTime() <= reqTime
  );

  const poSupplierIds = new Set(relevantPOs.map((po) => po.supplier_id));

  // 6.1: Who is on the list: every Active supplier with (a) >=1 PO in 548d, or (b) contract starting <= date
  const activeSuppliers = suppliers.filter(
    (s) =>
      s.status === 'Active' &&
      (poSupplierIds.has(s.supplier_id) || contractSupplierIds.has(s.supplier_id))
  );

  if (activeSuppliers.length === 0) return [];

  // Find max PO count for normalization
  let maxPOs = 1;
  const supplierPODetails = new Map<
    string,
    { count: number; mostRecentDate: number | null; mostRecentPrice: number | null }
  >();

  for (const s of activeSuppliers) {
    const sPOs = relevantPOs
      .filter((po) => po.supplier_id === s.supplier_id)
      .sort((a, b) => b.po_date.getTime() - a.po_date.getTime());

    const count = sPOs.length;
    if (count > maxPOs) maxPOs = count;

    supplierPODetails.set(s.supplier_id, {
      count,
      mostRecentDate: count > 0 ? sPOs[0].po_date.getTime() : null,
      mostRecentPrice: count > 0 ? sPOs[0].unit_price : null,
    });
  }

  const ranked: RankedSupplier[] = [];

  for (const s of activeSuppliers) {
    const details = supplierPODetails.get(s.supplier_id)!;
    const hasContract = contractSupplierIds.has(s.supplier_id);

    // Recency: 1 = last PO within 90 days, 0.5 = within a year (365d), 0 = older or none
    let recency = 0.0;
    if (details.mostRecentDate) {
      if (details.mostRecentDate >= cutoff90) {
        recency = 1.0;
      } else if (details.mostRecentDate >= cutoff365) {
        recency = 0.5;
      }
    }

    // Reference price (Section 6.3):
    // price on that supplier's most recent PO for the item in 548 days;
    // if none, the rate in its most recent contract for the item
    let refPrice: number | null = details.mostRecentPrice;
    if (refPrice === null && hasContract) {
      const sContracts = validItemContracts
        .filter((c) => c.supplier_id === s.supplier_id)
        .sort((a, b) => b.start_date.getTime() - a.start_date.getTime());
      if (sContracts.length > 0) {
        const line = itemContractLines.find(
          (cl) => cl.contract_id === sContracts[0].contract_id
        );
        if (line) refPrice = line.rate;
      }
    }

    // Normalized scores
    const normFreq = details.count / maxPOs;
    const normOnTime = (s.on_time_pct || 0) / 100;
    const normQuality = (s.quality_rating || 0) / 5.0;
    const contractScore = hasContract ? 1.0 : 0.0;

    const score =
      wRecency * recency +
      wFreq * normFreq +
      wContract * contractScore +
      wOnTime * normOnTime +
      wQuality * normQuality;

    ranked.push({
      supplier_id: s.supplier_id,
      name: s.name,
      status: s.status,
      pos_548d: details.count,
      recency,
      has_contract: hasContract,
      on_time_pct: s.on_time_pct,
      quality_rating: s.quality_rating,
      reference_price: refPrice,
      score,
      rank: 0,
    });
  }

  // Sort descending by score. In case of ties, prefer higher recency, then more POs, then higher quality
  ranked.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.0001) return b.score - a.score;
    if (b.recency !== a.recency) return b.recency - a.recency;
    if (b.pos_548d !== a.pos_548d) return b.pos_548d - a.pos_548d;
    return b.quality_rating - a.quality_rating;
  });

  ranked.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return ranked;
}

/**
 * Section 6.4: Suggesting suppliers for sourcing (RFQ / RFP / CAPEX)
 *
 * Take the preferred list in order. If it has fewer suppliers than needed (3 or 5),
 * add other Active suppliers that list the item's category in the supplier master,
 * best delivery and quality record first.
 *
 * New items get NO suggestions (Rule 6.4).
 */
export function getSuggestedSuppliersForSourcing(
  itemCode: string,
  category: string,
  requirementDate: Date,
  neededCount: number, // 3 for RFQ, 5 for RFP / CAPEX
  suppliers: ISupplier[],
  poHistory: IPOHistory[],
  contracts: IContract[],
  contractLines: IContractLine[],
  weights?: SupplierRankingWeights
): string[] {
  if (itemCode === 'NEW') {
    return []; // Rule 6.4: New items get no suggestions
  }

  const preferred = getPreferredSuppliers(
    itemCode,
    requirementDate,
    suppliers,
    poHistory,
    contracts,
    contractLines,
    weights
  );

  const suggestedIds: string[] = preferred.map((p) => p.supplier_id);

  if (suggestedIds.length >= neededCount) {
    return suggestedIds.slice(0, neededCount);
  }

  // Topping up from other Active suppliers that list the item's category in supplier master
  const alreadyAdded = new Set(suggestedIds);

  const categorySuppliers = suppliers
    .filter(
      (s) =>
        s.status === 'Active' &&
        !alreadyAdded.has(s.supplier_id) &&
        s.categories.some((cat) => cat.toLowerCase() === category.toLowerCase())
    )
    .sort((a, b) => {
      // Best delivery and quality record first
      const scoreA = (a.on_time_pct / 100) * 0.5 + (a.quality_rating / 5.0) * 0.5;
      const scoreB = (b.on_time_pct / 100) * 0.5 + (b.quality_rating / 5.0) * 0.5;
      if (Math.abs(scoreB - scoreA) > 0.0001) return scoreB - scoreA;
      if (b.quality_rating !== a.quality_rating) return b.quality_rating - a.quality_rating;
      return b.on_time_pct - a.on_time_pct;
    });

  for (const s of categorySuppliers) {
    suggestedIds.push(s.supplier_id);
    if (suggestedIds.length >= neededCount) break;
  }

  return suggestedIds.slice(0, neededCount);
}

export interface PreferredSupplierExportRow {
  item_code: string;
  rank: number;
  supplier_id: string;
  reference_price: number | '';
}

/**
 * Generate preferred suppliers CSV rows (item_code, rank, supplier_id, reference_price, top 3)
 * as of a chosen date for all items or a specific item.
 */
export function generatePreferredSuppliersExport(
  items: { item_code: string }[],
  asOfDate: Date,
  suppliers: ISupplier[],
  poHistory: IPOHistory[],
  contracts: IContract[],
  contractLines: IContractLine[],
  topN: number = 3,
  weights?: SupplierRankingWeights
): PreferredSupplierExportRow[] {
  const rows: PreferredSupplierExportRow[] = [];

  for (const item of items) {
    const ranked = getPreferredSuppliers(
      item.item_code,
      asOfDate,
      suppliers,
      poHistory,
      contracts,
      contractLines,
      weights
    );

    const topSuppliers = ranked.slice(0, topN);
    for (const s of topSuppliers) {
      rows.push({
        item_code: item.item_code,
        rank: s.rank,
        supplier_id: s.supplier_id,
        reference_price: s.reference_price !== null ? Math.round(s.reference_price * 100) / 100 : '',
      });
    }
  }

  return rows;
}

