import { stringify } from 'csv-stringify/sync';
import { ProcessedPRLineResult } from '../engine/engine';
import { PreferredSupplierExportRow } from '../engine/supplierRanker';

/**
 * Section 4: Output format
 * Exact headers:
 * pr_no,pr_line,resolved_item_code,group_id,po_id,decision,route,supplier_id,unit_price,group_value_inr,suggested_supplier_ids,policy_version,reason
 */
export function generateDecisionsCSV(results: ProcessedPRLineResult[]): string {
  const columns = [
    'pr_no',
    'pr_line',
    'resolved_item_code',
    'group_id',
    'po_id',
    'decision',
    'route',
    'supplier_id',
    'unit_price',
    'group_value_inr',
    'suggested_supplier_ids',
    'policy_version',
    'reason',
  ];

  const data = results.map((r) => [
    r.pr_no,
    r.pr_line,
    r.resolved_item_code,
    r.group_id,
    r.po_id,
    r.decision,
    r.route,
    r.supplier_id,
    r.unit_price,
    r.group_value_inr,
    r.suggested_supplier_ids,
    r.policy_version,
    r.reason,
  ]);

  return stringify(data, { header: true, columns });
}

/**
 * Preferred Supplier Export format:
 * item_code,rank,supplier_id,reference_price
 */
export function generatePreferredSuppliersCSV(
  rows: PreferredSupplierExportRow[]
): string {
  const columns = ['item_code', 'rank', 'supplier_id', 'reference_price'];

  const data = rows.map((r) => [
    r.item_code,
    r.rank,
    r.supplier_id,
    r.reference_price,
  ]);

  return stringify(data, { header: true, columns });
}
