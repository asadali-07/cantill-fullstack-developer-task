import { DecisionOutcome } from './decisionRules';
import { ClubbedRequirement } from './clubber';

export interface EvaluatedRequirement {
  requirement: ClubbedRequirement;
  outcome: DecisionOutcome;
  total_value: number;
  po_id?: string;
}

const MS_PER_HOUR = 60 * 60 * 1000;

interface OpenPO {
  po_id: string;
  supplier_id: string;
  plant: string;
  route: string;
  first_requirement_time: number;
  requirements: EvaluatedRequirement[];
}

/**
 * Section 7: Placing purchase orders (consolidation)
 *
 * 7.1: Combine requirements that end in a PO into one PO with several lines when:
 *   - same supplier
 *   - same plant
 *   - same route
 *   - raised within 24 hours of the first requirement on that PO (measured from creation time of first line)
 *
 * 7.2: Take requirements in order of creation time. A requirement joins the earliest open PO it qualifies for;
 *      otherwise it starts a new PO.
 *      Sourcing requests are NEVER combined.
 */
export function consolidatePOs(
  evaluatedRequirements: EvaluatedRequirement[],
  windowHours: number = 24
): EvaluatedRequirement[] {
  // Sort requirements by creation time of their first line (requirement_date)
  const sorted = [...evaluatedRequirements].sort(
    (a, b) =>
      a.requirement.requirement_date.getTime() -
      b.requirement.requirement_date.getTime()
  );

  const openPOs: OpenPO[] = [];
  let poCounter = 1;

  for (const item of sorted) {
    // Sourcing requests are never combined (Rule 7.2)
    if (item.outcome.decision !== 'PO' || !item.outcome.supplier_id) {
      continue;
    }

    const reqTime = item.requirement.requirement_date.getTime();
    const supplierId = item.outcome.supplier_id;
    const plant = item.requirement.plant;
    const route = item.outcome.route;

    // Find earliest open PO that qualifies
    let assignedPO: OpenPO | null = null;
    for (const po of openPOs) {
      if (
        po.supplier_id === supplierId &&
        po.plant === plant &&
        po.route === route
      ) {
        // Within windowHours of the first requirement on that PO
        const diffHours = (reqTime - po.first_requirement_time) / MS_PER_HOUR;
        if (diffHours >= 0 && diffHours <= windowHours) {
          assignedPO = po;
          break; // Join earliest
        }
      }
    }

    if (assignedPO) {
      assignedPO.requirements.push(item);
      item.po_id = assignedPO.po_id;
    } else {
      const newPOId = `PO-${String(poCounter++).padStart(4, '0')}`;
      const newPO: OpenPO = {
        po_id: newPOId,
        supplier_id: supplierId,
        plant,
        route,
        first_requirement_time: reqTime,
        requirements: [item],
      };
      openPOs.push(newPO);
      item.po_id = newPOId;
    }
  }

  return sorted;
}
