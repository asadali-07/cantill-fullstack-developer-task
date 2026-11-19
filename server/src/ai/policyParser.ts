import { getGeminiModel } from './geminiClient';
import { IPolicyRules } from '../models/PolicyVersion';

export interface PolicyDiffItem {
  field: string;
  label: string;
  oldValue: any;
  newValue: any;
  explanation: string;
}

export interface ProposedAmendment {
  proposedVersion: string;
  effectiveDate: string; // ISO date string
  summary: string;
  diff: PolicyDiffItem[];
  updatedRules: IPolicyRules & { custom_rules?: any[]; category_rules?: any; plant_rules?: any };
}

/**
 * Fallback parser using regex if Gemini API call fails or is unavailable
 */
function fallbackRuleParser(
  text: string,
  currentRules: IPolicyRules,
  currentVersion: string
): ProposedAmendment {
  const updated: any = JSON.parse(JSON.stringify(currentRules));
  const diff: PolicyDiffItem[] = [];

  // Match spot limit: e.g. "spot limit of 150000" or "spot PO threshold to 1.5 lakh"
  const spotMatch = text.match(/spot.*?(\d[\d,]*)/i);
  if (spotMatch) {
    const val = parseFloat(spotMatch[1].replace(/,/g, ''));
    if (val > 1000 && val !== updated.spot_po_limit) {
      diff.push({
        field: 'spot_po_limit',
        label: 'Spot PO Limit',
        oldValue: updated.spot_po_limit,
        newValue: val,
        explanation: `Updated spot PO spending threshold to ₹${val.toLocaleString('en-IN')}`,
      });
      updated.spot_po_limit = val;
    }
  }

  // Match emergency limit
  const emMatch = text.match(/emergency.*?(\d[\d,]*)/i);
  if (emMatch) {
    const val = parseFloat(emMatch[1].replace(/,/g, ''));
    if (val > 1000 && val !== updated.emergency_po_limit) {
      diff.push({
        field: 'emergency_po_limit',
        label: 'Emergency PO Limit',
        oldValue: updated.emergency_po_limit,
        newValue: val,
        explanation: `Updated emergency PO limit to ₹${val.toLocaleString('en-IN')}`,
      });
      updated.emergency_po_limit = val;
    }
  }

  // Match RFQ limit
  const rfqMatch = text.match(/rfq.*?(\d[\d,]*)/i);
  if (rfqMatch) {
    const val = parseFloat(rfqMatch[1].replace(/,/g, ''));
    if (val > 1000 && val !== updated.rfq_limit) {
      diff.push({
        field: 'rfq_limit',
        label: 'RFQ Threshold',
        oldValue: updated.rfq_limit,
        newValue: val,
        explanation: `Updated RFQ upper limit to ₹${val.toLocaleString('en-IN')}`,
      });
      updated.rfq_limit = val;
      updated.rfp_threshold = val;
    }
  }

  // Version bump: v5.0 -> v5.1
  const versionParts = currentVersion.split('.');
  const minor = parseInt(versionParts[1] || '0', 10) + 1;
  const proposedVersion = `${versionParts[0] || '5'}.${minor}`;

  return {
    proposedVersion,
    effectiveDate: new Date().toISOString().split('T')[0],
    summary: diff.length > 0
      ? `Applied ${diff.length} policy changes based on text amendment.`
      : 'Policy amendment recognized with no numeric threshold changes.',
    diff,
    updatedRules: updated,
  };
}

/**
 * Use Google Gemini to parse natural language policy amendments or amendment documents
 */
export async function parsePolicyAmendmentWithGemini(
  amendmentText: string,
  currentRules: IPolicyRules,
  currentVersion: string
): Promise<ProposedAmendment> {
  try {
    const model = getGeminiModel('gemini-3.1-flash-lite');

    const prompt = `
You are an expert procurement policy analyst for Corvo Engineering.
The current procurement policy is version ${currentVersion}.

The active rules currently stored as data are:
${JSON.stringify(currentRules, null, 2)}

A Procurement administrator has provided the following policy amendment description or document:
"""
${amendmentText}
"""

Analyze this amendment text carefully.
Determine what rules, limits, windows, vendor counts, supplier ranking weights, or plant/category-specific custom rules should change.

Return ONLY a valid JSON object (no markdown code blocks, no other text) with the following exact structure:
{
  "proposedVersion": "e.g. 5.1",
  "effectiveDate": "YYYY-MM-DD",
  "summary": "Clear 1-3 sentence plain language explanation of what changed and its business impact",
  "diff": [
    {
      "field": "name of rule field",
      "label": "Human friendly label",
      "oldValue": "previous value",
      "newValue": "new value",
      "explanation": "why this changed according to the amendment"
    }
  ],
  "updatedRules": {
    ...full updated rules object incorporating all changes, preserving unchanged fields...
    "custom_rules": [
      // Optional: add any new custom conditional rules mentioned (e.g. plant-specific rules or category overrides)
      // Example: { "id": "CR-01", "name": "Chk1 Electrical Rule", "conditions": { "plant": "CHK1", "category": "Electrical Spares" }, "outcome": { "route": "RFQ" } }
    ]
  }
}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Strip any markdown code fence if returned
    const cleanJson = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleanJson);
    return {
      proposedVersion: parsed.proposedVersion || '5.1',
      effectiveDate: parsed.effectiveDate || new Date().toISOString().split('T')[0],
      summary: parsed.summary || 'Policy amendment processed successfully.',
      diff: parsed.diff || [],
      updatedRules: {
        ...currentRules,
        ...parsed.updatedRules,
      },
    };
  } catch (error: any) {
    console.warn('[Gemini Policy Parser Error]:', error.message, '- falling back to regex parser');
    return fallbackRuleParser(amendmentText, currentRules, currentVersion);
  }
}
