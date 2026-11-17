import { IItem } from '../models/Item';
import { IPolicyRules } from '../models/PolicyVersion';
import { ApplicableContractResult } from './contracts';
import { ValuationResult } from './valuator';
import { RankedSupplier } from './supplierRanker';

export type DecisionType = 'PO' | 'SOURCING_REQUEST';
export type RouteType =
  | 'CONTRACT_PO'
  | 'EMERGENCY_PO'
  | 'SPOT_PO'
  | 'RFQ'
  | 'RFP'
  | 'CAPEX_SOURCING'
  | 'NEW_ITEM_SOURCING'
  | 'NOT_PROCESSED';

export interface DecisionOutcome {
  decision: DecisionType;
  route: RouteType;
  supplier_id?: string;
  unit_price?: number;
  contract_id?: string;
  suggested_supplier_ids: string[];
  policy_version: string;
  clause: string;
  reason: string;
}

export interface CustomPolicyRule {
  id: string;
  name: string;
  priority?: number; // 0 = evaluate before Capex, 5.25 = between Contract and Emergency, etc.
  conditions: {
    plant?: string;
    category?: string;
    item_code?: string;
    item_type?: string;
    min_value?: number;
    max_value?: number;
    is_emergency?: boolean;
  };
  outcome: {
    decision: DecisionType;
    route: RouteType;
    suggested_vendor_count?: number;
    reason_template: string;
  };
}

/**
 * Section 5: Decision rules
 * Apply rules in order. The first rule that fits decides the outcome.
 * Supports dynamic limits, plant-specific rules, category-specific overrides, and custom rules as data.
 */
export function applyDecisionRules(
  itemCode: string,
  matchedItem: IItem | null,
  isEmergency: boolean,
  valuation: ValuationResult,
  contractResult: ApplicableContractResult,
  preferredSuppliers: RankedSupplier[],
  suggestedSourcingSuppliers: (neededCount: number) => string[],
  policyVersionName: string,
  rules: IPolicyRules & {
    custom_rules?: CustomPolicyRule[];
    category_rules?: Record<string, Partial<IPolicyRules>>;
    plant_rules?: Record<string, any>;
  },
  plant?: string
): DecisionOutcome {
  const version = policyVersionName || '5.0';

  // Rule 1.2: New Item Sourcing (checked first if item is not in master)
  if (itemCode === 'NEW' || !matchedItem) {
    return {
      decision: 'SOURCING_REQUEST',
      route: 'NEW_ITEM_SOURCING',
      suggested_supplier_ids: [], // Rule 6.4: New items get no suggestions
      policy_version: version,
      clause: '1.2',
      reason: `Clause 1.2: Item not found in item master. Sourcing request created at requester's estimated unit price ₹${valuation.unitPrice.toLocaleString('en-IN')}.`,
    };
  }

  const category = matchedItem.category || '';

  // Check category or plant-specific limit overrides
  const categoryOverride = rules.category_rules?.[category] || {};
  const plantOverride = plant ? rules.plant_rules?.[plant] || {} : {};

  const spotLimit = categoryOverride.spot_po_limit ?? plantOverride.spot_po_limit ?? rules.spot_po_limit ?? 200000;
  const emergencyLimit = categoryOverride.emergency_po_limit ?? plantOverride.emergency_po_limit ?? rules.emergency_po_limit ?? 500000;
  const rfqLimit = categoryOverride.rfq_limit ?? plantOverride.rfq_limit ?? rules.rfq_limit ?? 1000000;

  // Evaluate Custom Rules with priority < 5.1 (e.g. high-priority plant rules)
  if (Array.isArray(rules.custom_rules)) {
    for (const cr of rules.custom_rules) {
      if ((cr.priority ?? 5.0) < 5.1) {
        if (matchesCondition(cr.conditions, { plant, category, itemCode, itemType: matchedItem.item_type, totalValue: valuation.totalValue, isEmergency })) {
          const count = cr.outcome.suggested_vendor_count ?? 3;
          const suggested = cr.outcome.decision === 'SOURCING_REQUEST' ? suggestedSourcingSuppliers(count) : [];
          return {
            decision: cr.outcome.decision,
            route: cr.outcome.route,
            suggested_supplier_ids: suggested,
            policy_version: version,
            clause: `Custom:${cr.id}`,
            reason: cr.outcome.reason_template || `Custom rule ${cr.name} matched.`,
          };
        }
      }
    }
  }

  // Rule 5.1: The item type is Capex
  if (matchedItem.item_type === 'Capex') {
    const count = rules.capex_vendor_count ?? 5;
    const suggested = suggestedSourcingSuppliers(count);
    return {
      decision: 'SOURCING_REQUEST',
      route: 'CAPEX_SOURCING',
      suggested_supplier_ids: suggested,
      policy_version: version,
      clause: '5.1',
      reason: `Clause 5.1: Capex item type requires sourcing event with ${count} suggested suppliers. Needs capex approval.`,
    };
  }

  // Rule 5.2: A contract can be used (4.1 to 4.3)
  if (contractResult.canBeUsed && contractResult.contract && contractResult.rate !== null) {
    const contract = contractResult.contract;
    return {
      decision: 'PO',
      route: 'CONTRACT_PO',
      supplier_id: contract.supplier_id,
      unit_price: contractResult.rate,
      contract_id: contract.contract_id,
      suggested_supplier_ids: [],
      policy_version: version,
      clause: '5.2',
      reason: `Clause 5.2: Covered by rate contract ${contract.contract_id} with ${contract.supplier_name || contract.supplier_id} at ₹${contractResult.rate.toLocaleString('en-IN')}. Valid with ceiling remaining.`,
    };
  }

  // Supplier ranking for direct POs (Rules 5.3 & 5.4 need 1st preferred supplier)
  const firstPreferred = preferredSuppliers.length > 0 ? preferredSuppliers[0] : null;
  const boughtInLast365Days = valuation.hasActivePurchaseInLast365Days;

  // Rule 5.3: Emergency, value <= emergencyLimit, bought in last 365d
  const allowEmergency = plantOverride.allow_emergency_po ?? true;
  if (isEmergency && allowEmergency && valuation.totalValue <= emergencyLimit && boughtInLast365Days && firstPreferred) {
    const price = firstPreferred.reference_price ?? valuation.unitPrice;
    return {
      decision: 'PO',
      route: 'EMERGENCY_PO',
      supplier_id: firstPreferred.supplier_id,
      unit_price: price,
      suggested_supplier_ids: [],
      policy_version: version,
      clause: '5.3',
      reason: `Clause 5.3: Emergency purchase of ₹${valuation.totalValue.toLocaleString('en-IN')} (≤ ₹${emergencyLimit.toLocaleString('en-IN')}) with purchase history in last 365 days. Direct PO to 1st preferred supplier ${firstPreferred.name || firstPreferred.supplier_id} at reference price ₹${price.toLocaleString('en-IN')}.`,
    };
  }

  // Rule 5.4: Value below spot_po_limit, bought in last 365d
  if (valuation.totalValue < spotLimit && boughtInLast365Days && firstPreferred) {
    const price = firstPreferred.reference_price ?? valuation.unitPrice;
    return {
      decision: 'PO',
      route: 'SPOT_PO',
      supplier_id: firstPreferred.supplier_id,
      unit_price: price,
      suggested_supplier_ids: [],
      policy_version: version,
      clause: '5.4',
      reason: `Clause 5.4: Value ₹${valuation.totalValue.toLocaleString('en-IN')} below ₹${spotLimit.toLocaleString('en-IN')} limit with purchase history in last 365 days. Spot PO to 1st preferred supplier ${firstPreferred.name || firstPreferred.supplier_id} at reference price ₹${price.toLocaleString('en-IN')}.`,
    };
  }

  // Rule 5.5: Value below rfq_limit, including small items never bought in last 365d
  if (valuation.totalValue < rfqLimit) {
    const count = rules.rfq_vendor_count ?? 3;
    const suggested = suggestedSourcingSuppliers(count);
    const whyDetail = !boughtInLast365Days
      ? `No purchase from an Active supplier in the last 365 days (Clause 5.5).`
      : `No applicable contract with ceiling remaining, and value ₹${valuation.totalValue.toLocaleString('en-IN')} is between spot threshold and ₹${rfqLimit.toLocaleString('en-IN')}.`;

    return {
      decision: 'SOURCING_REQUEST',
      route: 'RFQ',
      suggested_supplier_ids: suggested,
      policy_version: version,
      clause: '5.5',
      reason: `Clause 5.5: RFQ sourcing request. ${whyDetail}`,
    };
  }

  // Rule 5.6: Value ₹10,00,000 or more
  const rfpCount = rules.rfp_vendor_count ?? 5;
  const suggestedRfp = suggestedSourcingSuppliers(rfpCount);
  return {
    decision: 'SOURCING_REQUEST',
    route: 'RFP',
    suggested_supplier_ids: suggestedRfp,
    policy_version: version,
    clause: '5.6',
    reason: `Clause 5.6: High value requirement of ₹${valuation.totalValue.toLocaleString('en-IN')} (≥ ₹${rfqLimit.toLocaleString('en-IN')}) requires formal RFP sourcing with ${rfpCount} suppliers.`,
  };
}

function matchesCondition(
  conditions: CustomPolicyRule['conditions'],
  target: {
    plant?: string;
    category?: string;
    itemCode?: string;
    itemType?: string;
    totalValue: number;
    isEmergency: boolean;
  }
): boolean {
  if (conditions.plant && target.plant && conditions.plant.toUpperCase() !== target.plant.toUpperCase()) {
    return false;
  }
  if (conditions.category && target.category && conditions.category.toLowerCase() !== target.category.toLowerCase()) {
    return false;
  }
  if (conditions.item_code && conditions.item_code !== target.itemCode) {
    return false;
  }
  if (conditions.item_type && conditions.item_type !== target.itemType) {
    return false;
  }
  if (conditions.min_value !== undefined && target.totalValue < conditions.min_value) {
    return false;
  }
  if (conditions.max_value !== undefined && target.totalValue > conditions.max_value) {
    return false;
  }
  if (conditions.is_emergency !== undefined && conditions.is_emergency !== target.isEmergency) {
    return false;
  }
  return true;
}
