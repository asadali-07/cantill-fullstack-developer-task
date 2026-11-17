import { IItem } from '../models/Item';

export interface RawPRLine {
  pr_no: string;
  pr_line: number;
  created_at: Date;
  requester?: string;
  department?: string;
  plant: string;
  item_code?: string;
  description: string;
  quantity: number;
  uom: string;
  estimated_unit_price?: number;
  need_by_date: Date;
  urgency: 'Normal' | 'Emergency' | string;
  resolved_item_code?: string;
  matched_item?: IItem | null;
}

export interface ClubbedRequirement {
  group_id: string; // e.g. GRP-0001
  plant: string;
  item_code: string; // or 'NEW'
  item_description: string;
  uom: string;
  total_quantity: number;
  requirement_date: Date; // Creation date of the first line
  first_need_by_date: Date;
  is_emergency: boolean;
  is_new_item: boolean;
  lines: RawPRLine[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Section 2: Clubbing requirements (anti-splitting)
 *
 * 2.2: Take PR lines in order of creation time (then PR number, then line number).
 * A line joins an existing requirement when it is for the same item, same plant,
 * was created within 14 calendar days of the requirement's first line,
 * and its need-by date is within 7 days (either side) of the first line's need-by date.
 * Otherwise it starts a new requirement. If it could join more than one, it joins the earliest.
 *
 * Section 1.2: A line that matches no item master item is a new item, and is NEVER clubbed.
 */
export function clubPRLines(
  lines: RawPRLine[],
  policyRules?: {
    clubbing_window_days?: number;
    clubbing_needby_tolerance_days?: number;
  }
): ClubbedRequirement[] {
  const windowDays = policyRules?.clubbing_window_days ?? 14;
  const toleranceDays = policyRules?.clubbing_needby_tolerance_days ?? 7;

  // 1. Sort PR lines in order of creation time, then PR number, then line number
  const sortedLines = [...lines].sort((a, b) => {
    const timeDiff = a.created_at.getTime() - b.created_at.getTime();
    if (timeDiff !== 0) return timeDiff;
    const prDiff = a.pr_no.localeCompare(b.pr_no);
    if (prDiff !== 0) return prDiff;
    return a.pr_line - b.pr_line;
  });

  const requirements: ClubbedRequirement[] = [];
  let groupCounter = 1;

  for (const line of sortedLines) {
    const itemCode = line.resolved_item_code || 'NEW';
    const isNew = itemCode === 'NEW';

    // If it's a new item, it is NEVER clubbed with other lines (Rule 1.2)
    if (isNew) {
      const groupId = `GRP-${String(groupCounter++).padStart(4, '0')}`;
      requirements.push({
        group_id: groupId,
        plant: line.plant,
        item_code: 'NEW',
        item_description: line.description,
        uom: line.uom || 'NOS',
        total_quantity: line.quantity,
        requirement_date: line.created_at,
        first_need_by_date: line.need_by_date,
        is_emergency: line.urgency?.toLowerCase() === 'emergency',
        is_new_item: true,
        lines: [line],
      });
      continue;
    }

    // Check if it qualifies to join an existing requirement
    let joined = false;
    for (const req of requirements) {
      if (req.is_new_item) continue;
      if (req.item_code !== itemCode) continue;
      if (req.plant !== line.plant) continue;

      // Created within windowDays (14 days) of first line's creation date
      const createdDiffDays =
        (line.created_at.getTime() - req.requirement_date.getTime()) / MS_PER_DAY;
      if (createdDiffDays < 0 || createdDiffDays > windowDays) continue;

      // Need-by date is within toleranceDays (7 days) either side of first line's need-by date
      const needByDiffDays =
        Math.abs(line.need_by_date.getTime() - req.first_need_by_date.getTime()) /
        MS_PER_DAY;
      if (needByDiffDays > toleranceDays) continue;

      // Joins earliest matching requirement
      req.lines.push(line);
      req.total_quantity += line.quantity;
      if (line.urgency?.toLowerCase() === 'emergency') {
        req.is_emergency = true;
      }
      joined = true;
      break;
    }

    if (!joined) {
      const groupId = `GRP-${String(groupCounter++).padStart(4, '0')}`;
      requirements.push({
        group_id: groupId,
        plant: line.plant,
        item_code: itemCode,
        item_description: line.matched_item?.description || line.description,
        uom: line.uom || line.matched_item?.uom || 'NOS',
        total_quantity: line.quantity,
        requirement_date: line.created_at,
        first_need_by_date: line.need_by_date,
        is_emergency: line.urgency?.toLowerCase() === 'emergency',
        is_new_item: false,
        lines: [line],
      });
    }
  }

  return requirements;
}
