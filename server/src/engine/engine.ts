import { Item, IItem } from '../models/Item';
import { Supplier, ISupplier } from '../models/Supplier';
import { POHistory, IPOHistory } from '../models/POHistory';
import { Contract, IContract } from '../models/Contract';
import { ContractLine, IContractLine } from '../models/ContractLine';
import { PolicyVersion, IPolicyVersion } from '../models/PolicyVersion';
import { matchItem } from './matcher';
import { clubPRLines, RawPRLine, ClubbedRequirement } from './clubber';
import { ContractTracker } from './contracts';
import { valueRequirement, ValuationResult } from './valuator';
import {
  getPreferredSuppliers,
  getSuggestedSuppliersForSourcing,
} from './supplierRanker';
import { applyDecisionRules, DecisionOutcome } from './decisionRules';
import { consolidatePOs, EvaluatedRequirement } from './consolidator';

export interface ProcessedPRLineResult {
  pr_no: string;
  pr_line: number;
  resolved_item_code: string;
  group_id: string;
  po_id: string;
  decision: string;
  route: string;
  supplier_id: string;
  unit_price: string;
  group_value_inr: number;
  suggested_supplier_ids: string;
  policy_version: string;
  reason: string;
}

export interface EngineRunContext {
  policyVersion?: string; // Optional: specify version, defaults to active
  customRules?: any;
}

/**
 * Execute the complete PR-to-PO Decision Pipeline
 */
export async function runDecisionEngine(
  rawPRs: RawPRLine[],
  context: EngineRunContext = {}
): Promise<{
  results: ProcessedPRLineResult[];
  clubbedRequirements: ClubbedRequirement[];
  activePolicy: IPolicyVersion;
}> {
  // 1. Load active policy
  let activePolicy = await PolicyVersion.findOne({
    ...(context.policyVersion ? { version: context.policyVersion } : { is_active: true }),
  }).sort({ effective_date: -1 });

  if (!activePolicy) {
    activePolicy = await PolicyVersion.findOne().sort({ effective_date: -1 });
  }

  const policyRules = {
    ...activePolicy?.rules,
    ...(context.customRules || {}),
  };
  const policyVersionName = activePolicy?.version || '5.0';

  // 2. Load reference data
  const [items, suppliers, poHistory, contracts, contractLines] = await Promise.all([
    Item.find().lean() as unknown as Promise<IItem[]>,
    Supplier.find().lean() as unknown as Promise<ISupplier[]>,
    POHistory.find().lean() as unknown as Promise<IPOHistory[]>,
    Contract.find().lean() as unknown as Promise<IContract[]>,
    ContractLine.find().lean() as unknown as Promise<IContractLine[]>,
  ]);

  // 3. Step 1: Item Matching for each PR line
  const matchedPRs: RawPRLine[] = rawPRs.map((pr) => {
    const { matchedItem, resolvedCode } = matchItem(
      pr.item_code,
      pr.description,
      items
    );
    return {
      ...pr,
      resolved_item_code: resolvedCode,
      matched_item: matchedItem,
    };
  });

  // 4. Step 2: Clubbing into requirements
  const clubbed = clubPRLines(matchedPRs, policyRules);

  // 5. Initialize contract state tracker (handles dynamic ceiling consumption in order)
  const contractTracker = new ContractTracker(contracts, contractLines, suppliers);

  // 6. Evaluate each requirement in order of requirement date
  const evaluatedRequirements: EvaluatedRequirement[] = [];

  // Sort requirements chronologically by requirement_date
  const chronologicalRequirements = [...clubbed].sort(
    (a, b) => a.requirement_date.getTime() - b.requirement_date.getTime()
  );

  for (const req of chronologicalRequirements) {
    const itemCode = req.item_code;
    const matchedItem =
      itemCode !== 'NEW' ? items.find((i) => i.item_code === itemCode) || null : null;
    const category = matchedItem?.category || '';

    // Step 4: Check applicable contracts & ceiling
    const contractResult =
      itemCode !== 'NEW'
        ? contractTracker.findContract(itemCode, req.total_quantity, req.requirement_date)
        : {
            contract: null,
            contractLine: null,
            rate: null,
            canBeUsed: false,
            lowestRateAmongAllApplicable: null,
          };

    // Step 3: Valuing requirement
    const requesterEstPrice = req.lines.find((l) => l.estimated_unit_price && l.estimated_unit_price > 0)?.estimated_unit_price;

    const valuation: ValuationResult = valueRequirement(
      itemCode,
      req.total_quantity,
      req.requirement_date,
      matchedItem,
      contractResult,
      poHistory,
      suppliers,
      requesterEstPrice
    );

    // Step 6: Preferred supplier ranking
    const preferredSuppliers =
      itemCode !== 'NEW'
        ? getPreferredSuppliers(
            itemCode,
            req.requirement_date,
            suppliers,
            poHistory,
            contracts,
            contractLines,
            policyRules.preferred_supplier_weights
          )
        : [];

    const suggestSuppliersHelper = (neededCount: number) =>
      getSuggestedSuppliersForSourcing(
        itemCode,
        category,
        req.requirement_date,
        neededCount,
        suppliers,
        poHistory,
        contracts,
        contractLines,
        policyRules.preferred_supplier_weights
      );

    // Step 5: Apply decision rules in priority order
    const outcome: DecisionOutcome = applyDecisionRules(
      itemCode,
      matchedItem,
      req.is_emergency,
      valuation,
      contractResult,
      preferredSuppliers,
      suggestSuppliersHelper,
      policyVersionName,
      policyRules,
      req.plant
    );

    // If decision is CONTRACT_PO, consume ceiling
    if (outcome.route === 'CONTRACT_PO' && contractResult.contract && contractResult.rate !== null) {
      contractTracker.consumeCeiling(
        contractResult.contract.contract_id,
        req.total_quantity * contractResult.rate
      );
    }

    evaluatedRequirements.push({
      requirement: req,
      outcome,
      total_value: valuation.totalValue,
    });
  }

  // 7. Step 7: PO Consolidation
  const consolidated = consolidatePOs(
    evaluatedRequirements,
    policyRules.po_consolidation_window_hours ?? 24
  );

  // Map requirement evaluation results by group_id for quick lookup
  const reqMap = new Map<string, EvaluatedRequirement>();
  for (const item of consolidated) {
    reqMap.set(item.requirement.group_id, item);
  }

  // 8. Expand back to PR lines in the original input order
  const results: ProcessedPRLineResult[] = rawPRs.map((original) => {
    // Find which requirement this line belongs to
    const evalReq = consolidated.find((er) =>
      er.requirement.lines.some(
        (l) => l.pr_no === original.pr_no && l.pr_line === original.pr_line
      )
    );

    if (!evalReq) {
      return {
        pr_no: original.pr_no,
        pr_line: original.pr_line,
        resolved_item_code: original.item_code || 'NEW',
        group_id: '',
        po_id: '',
        decision: 'SOURCING_REQUEST',
        route: 'NOT_PROCESSED',
        supplier_id: '',
        unit_price: '',
        group_value_inr: 0,
        suggested_supplier_ids: '',
        policy_version: policyVersionName,
        reason: 'Could not process line',
      };
    }

    const { requirement, outcome, total_value, po_id } = evalReq;

    // Format unit price to 2 decimal places if number
    const formattedUnitPrice =
      outcome.unit_price !== undefined && outcome.unit_price !== null
        ? String(Math.round(outcome.unit_price * 100) / 100)
        : '';

    return {
      pr_no: original.pr_no,
      pr_line: original.pr_line,
      resolved_item_code: requirement.item_code,
      group_id: requirement.group_id,
      po_id: po_id || '',
      decision: outcome.decision,
      route: outcome.route,
      supplier_id: outcome.supplier_id || '',
      unit_price: formattedUnitPrice,
      group_value_inr: total_value,
      suggested_supplier_ids: (outcome.suggested_supplier_ids || []).join(';'),
      policy_version: outcome.policy_version,
      reason: outcome.reason,
    };
  });

  return {
    results,
    clubbedRequirements: clubbed,
    activePolicy: activePolicy as IPolicyVersion,
  };
}
