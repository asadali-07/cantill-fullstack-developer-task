import { IItem } from '../models/Item';

// Cache for item master items to avoid repeated DB calls during batch processing
let itemCache: IItem[] = [];

export function setItemCache(items: IItem[]): void {
  itemCache = items;
}

/**
 * Normalize a text string for matching:
 * - lowercase
 * - normalize whitespace
 * - remove common special characters and noise words like "- urgent", "as per sample", etc.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/-?\s*urgent/gi, '')
    .replace(/as per sample/gi, '')
    .replace(/\(repeat\)/gi, '')
    .replace(/for maintenance/gi, '')
    .replace(/["'(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Common abbreviations in procurement descriptions
 */
const ABBREVIATIONS: Record<string, string> = {
  'brg': 'bearing',
  'pneu': 'pneumatic',
  'hyd': 'hydraulic',
  'rod': 'electrode',
  'vci bag': 'vci bag 600x900',
};

/**
 * Expand known short forms
 */
function expandAbbreviations(text: string): string {
  let result = text;
  for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    result = result.replace(regex, expansion);
  }
  return result;
}

/**
 * Match a PR line to an Item in the Item Master.
 * Returns the matched Item, or null if it's a NEW item (Section 1.2).
 */
export function matchItem(
  itemCode: string | undefined | null,
  description: string,
  allItems: IItem[]
): { matchedItem: IItem | null; resolvedCode: string } {
  // Rule 1.1: If requester provided an item code and it exists, use it
  if (itemCode && itemCode.trim() !== '') {
    const code = itemCode.trim();
    const found = allItems.find(
      (it) => it.item_code.toLowerCase() === code.toLowerCase()
    );
    if (found) {
      return { matchedItem: found, resolvedCode: found.item_code };
    }
  }

  // If no item code or code not found, match description against item master
  const cleanDesc = normalizeText(description);
  const expandedDesc = expandAbbreviations(cleanDesc);

  // 1. Direct exact description match (case-insensitive)
  for (const it of allItems) {
    const masterDesc = normalizeText(it.description);
    if (cleanDesc === masterDesc || expandedDesc === masterDesc) {
      return { matchedItem: it, resolvedCode: it.item_code };
    }
  }

  // 2. Token-based matching
  // Check if all significant tokens of the item or master description match
  const descTokens = expandedDesc.split(' ').filter((t) => t.length > 1);

  let bestMatch: IItem | null = null;
  let highestScore = 0;

  for (const it of allItems) {
    const masterClean = normalizeText(it.description);
    const masterTokens = masterClean.split(' ').filter((t) => t.length > 1);

    // Count matching tokens
    let matches = 0;
    for (const token of descTokens) {
      if (masterTokens.includes(token)) {
        matches++;
      } else if (masterTokens.some((mt) => mt.includes(token) || token.includes(mt))) {
        matches += 0.8;
      }
    }

    // Score based on token overlap relative to master tokens
    const score = matches / Math.max(descTokens.length, masterTokens.length);

    // Also check substring containment
    const isSubstring =
      masterClean.includes(expandedDesc) || expandedDesc.includes(masterClean);

    const finalScore = isSubstring ? Math.max(score, 0.85) : score;

    if (finalScore > highestScore && finalScore >= 0.6) {
      highestScore = finalScore;
      bestMatch = it;
    }
  }

  if (bestMatch) {
    return { matchedItem: bestMatch, resolvedCode: bestMatch.item_code };
  }

  // Section 1.2: A line that matches no item master item is a new item
  return { matchedItem: null, resolvedCode: 'NEW' };
}
