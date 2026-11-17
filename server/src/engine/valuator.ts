import { IItem } from '../models/Item';
import { IPOHistory } from '../models/POHistory';
import { ISupplier } from '../models/Supplier';
import { ApplicableContractResult } from './contracts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ValuationResult {
  unitPrice: number;
  totalValue: number;
  priceSource: 'contract_used' | 'lowest_contract' | 'po_history_365d' | 'item_master' | 'requester_estimate';
  contractIdUsed?: string;
  poNumberReliedOn?: string;
  hasActivePurchaseInLast365Days: boolean;
}

/**
 * Section 3: Valuing a requirement
 *
 * 3.1: Requirement value = total quantity * unit price, where unit price is the first of:
 *   (a) rate of contract that will be used, or if every applicable contract is out of ceiling,
 *       the lowest applicable contract rate;
 *   (b) price on most recent PO for item in 365 days before requirement date (from Active supplier);
 *   (c) item master standard price.
 *
 * Section 1.2: New items are valued at quantity * requester's estimated unit price.
 */
export function valueRequirement(
  itemCode: string,
  totalQuantity: number,
  requirementDate: Date,
  matchedItem: IItem | null,
  contractResult: ApplicableContractResult,
  poHistory: IPOHistory[],
  suppliers: ISupplier[],
  requesterEstimatedPrice?: number
): ValuationResult {
  // Case 1: New item (Section 1.2)
  if (itemCode === 'NEW' || !matchedItem) {
    const estPrice = requesterEstimatedPrice && requesterEstimatedPrice > 0 ? requesterEstimatedPrice : 0;
    return {
      unitPrice: estPrice,
      totalValue: Math.round(totalQuantity * estPrice),
      priceSource: 'requester_estimate',
      hasActivePurchaseInLast365Days: false,
    };
  }

  const reqTime = requirementDate.getTime();
  const cutoff365 = reqTime - 365 * MS_PER_DAY;

  // Active supplier set
  const activeSupplierIds = new Set(
    suppliers.filter((s) => s.status === 'Active').map((s) => s.supplier_id)
  );

  // Recent POs for this item in 365 days from Active suppliers
  const recentActivePOs = poHistory
    .filter(
      (po) =>
        po.item_code === itemCode &&
        activeSupplierIds.has(po.supplier_id) &&
        po.po_date.getTime() >= cutoff365 &&
        po.po_date.getTime() <= reqTime
    )
    .sort((a, b) => b.po_date.getTime() - a.po_date.getTime());

  const hasActivePurchaseInLast365Days = recentActivePOs.length > 0;
  const mostRecentPO = hasActivePurchaseInLast365Days ? recentActivePOs[0] : null;

  // (a) Contract rate to be used, or lowest applicable contract rate
  if (contractResult.canBeUsed && contractResult.rate !== null && contractResult.contract) {
    return {
      unitPrice: contractResult.rate,
      totalValue: Math.round(totalQuantity * contractResult.rate),
      priceSource: 'contract_used',
      contractIdUsed: contractResult.contract.contract_id,
      hasActivePurchaseInLast365Days,
    };
  }

  if (
    !contractResult.canBeUsed &&
    contractResult.lowestRateAmongAllApplicable !== null
  ) {
    // Every applicable contract is out of ceiling (Worked Example #3)
    const rate = contractResult.lowestRateAmongAllApplicable;
    return {
      unitPrice: rate,
      totalValue: Math.round(totalQuantity * rate),
      priceSource: 'lowest_contract',
      hasActivePurchaseInLast365Days,
    };
  }

  // (b) Most recent PO in 365 days before requirement date
  if (mostRecentPO) {
    return {
      unitPrice: mostRecentPO.unit_price,
      totalValue: Math.round(totalQuantity * mostRecentPO.unit_price),
      priceSource: 'po_history_365d',
      poNumberReliedOn: mostRecentPO.po_number,
      hasActivePurchaseInLast365Days,
    };
  }

  // (c) Item master standard price
  const stdPrice = matchedItem.standard_price || 0;
  return {
    unitPrice: stdPrice,
    totalValue: Math.round(totalQuantity * stdPrice),
    priceSource: 'item_master',
    hasActivePurchaseInLast365Days,
  };
}
