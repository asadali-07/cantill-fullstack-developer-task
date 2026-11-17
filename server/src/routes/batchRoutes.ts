import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { runDecisionEngine, ProcessedPRLineResult } from '../engine/engine';
import { RawPRLine } from '../engine/clubber';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { Decision } from '../models/Decision';
import { generateDecisionsCSV } from '../utils/csvExport';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// In-memory cache for latest batch export
let latestBatchResults: { batchId: string; results: ProcessedPRLineResult[] } | null = null;

/**
 * Helper to parse CSV string into RawPRLine array
 */
function parsePRBatchCSV(csvContent: string): RawPRLine[] {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records.map((r: any) => ({
    pr_no: r.pr_no,
    pr_line: parseInt(r.pr_line || '1', 10),
    created_at: new Date(r.created_at),
    requester: r.requester || '',
    department: r.department || '',
    plant: r.plant,
    item_code: r.item_code || '',
    description: r.description,
    quantity: parseFloat(r.quantity),
    uom: r.uom || 'NOS',
    estimated_unit_price: r.estimated_unit_price ? parseFloat(r.estimated_unit_price) : undefined,
    need_by_date: new Date(r.need_by_date),
    urgency: r.urgency || 'Normal',
  }));
}

/**
 * POST /api/process-batch
 * Accepts either:
 * - multipart/form-data with `file`
 * - JSON with `{ csv: "..." }` or `{ prLines: [...] }`
 */
router.post(
  '/process-batch',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      let rawPRs: RawPRLine[] = [];

      if (req.file) {
        const fileContent = req.file.buffer.toString('utf-8');
        rawPRs = parsePRBatchCSV(fileContent);
      } else if (req.body?.csv) {
        rawPRs = parsePRBatchCSV(req.body.csv);
      } else if (req.body?.prLines && Array.isArray(req.body.prLines)) {
        rawPRs = req.body.prLines.map((r: any) => ({
          ...r,
          created_at: new Date(r.created_at),
          need_by_date: new Date(r.need_by_date),
          quantity: parseFloat(r.quantity),
          pr_line: parseInt(r.pr_line || '1', 10),
        }));
      } else {
        res.status(400).json({
          error: 'No CSV file or PR data provided. Upload a file or provide CSV string.',
        });
        return;
      }

      if (rawPRs.length === 0) {
        res.status(400).json({ error: 'Batch is empty. No valid PR lines found.' });
        return;
      }

      const batchId = `BATCH-${Date.now()}`;
      const policyVersion = req.query.policy_version as string | undefined;

      // 1. Run the Decision Engine
      const startTime = Date.now();
      const { results, clubbedRequirements, activePolicy } = await runDecisionEngine(
        rawPRs,
        { policyVersion }
      );
      const processingTimeMs = Date.now() - startTime;

      // Cache for quick download
      latestBatchResults = { batchId, results };

      // 2. Persist to MongoDB asynchronously
      const prDocs = rawPRs.map((pr) => ({
        ...pr,
        batch_id: batchId,
        source: 'csv_batch',
        status: 'processed',
      }));

      const decisionDocs = clubbedRequirements.map((req) => {
        const lineResult = results.find((r) => r.group_id === req.group_id);
        return {
          decision_id: `DEC-${req.group_id}-${batchId.slice(-4)}`,
          batch_id: batchId,
          policy_version: lineResult?.policy_version || activePolicy.version,
          pr_lines: req.lines.map((l) => ({ pr_no: l.pr_no, pr_line: l.pr_line })),
          item_code: req.item_code,
          item_description: req.item_description,
          plant: req.plant,
          total_quantity: req.total_quantity,
          uom: req.uom,
          unit_price: lineResult?.unit_price ? parseFloat(lineResult.unit_price) : 0,
          total_value: lineResult?.group_value_inr || 0,
          decision: lineResult?.decision || 'SOURCING_REQUEST',
          decision_reason: lineResult?.reason || '',
          suggested_suppliers: (lineResult?.suggested_supplier_ids || '')
            .split(';')
            .filter(Boolean)
            .map((s, idx) => ({ supplier_id: s, rank: idx + 1 })),
          po_number: lineResult?.po_id || undefined,
          status: 'pending_review',
        };
      });

      Promise.all([
        PurchaseRequisition.insertMany(prDocs).catch((err) =>
          console.error('[DB] Error saving PRs:', err)
        ),
        Decision.insertMany(decisionDocs).catch((err) =>
          console.error('[DB] Error saving Decisions:', err)
        ),
      ]);

      // Calculate summary metrics
      const routeBreakdown: Record<string, number> = {};
      let totalValue = 0;
      for (const r of results) {
        routeBreakdown[r.route] = (routeBreakdown[r.route] || 0) + 1;
        totalValue += r.group_value_inr;
      }

      res.json({
        success: true,
        batchId,
        policyVersion: activePolicy.version,
        totalLines: results.length,
        totalRequirements: clubbedRequirements.length,
        processingTimeMs,
        routeBreakdown,
        results,
        csvExportUrl: `/api/process-batch/export?batch_id=${batchId}`,
      });
    } catch (err: any) {
      console.error('[API] process-batch error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }
);

/**
 * GET /api/process-batch/export
 * Downloads CSV of results matching the exact 13 columns in Section 4.
 */
router.get('/process-batch/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const filename = (req.query.filename as string) || 'decisions.csv';
    let resultsToExport: ProcessedPRLineResult[] | null = null;

    if (latestBatchResults) {
      resultsToExport = latestBatchResults.results;
    }

    if (!resultsToExport) {
      // Fallback: run sample batch if nothing in memory
      res.status(404).json({ error: 'No batch processed yet. Please upload a batch first.' });
      return;
    }

    const csvOutput = generateDecisionsCSV(resultsToExport);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvOutput);
  } catch (err: any) {
    console.error('[API] export error:', err);
    res.status(500).json({ error: err.message || 'Export error' });
  }
});

export default router;
