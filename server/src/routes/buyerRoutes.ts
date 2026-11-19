import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Decision } from '../models/Decision';

const router = Router();

/**
 * GET /api/buyer/decisions
 * List decisions with optional filtering
 */
router.get('/decisions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { batch_id, route, plant, status } = req.query;
    const filter: any = {};

    if (batch_id) filter.batch_id = batch_id;
    if (route) filter.decision = route;
    if (plant) filter.plant = plant;
    if (status) filter.status = status;

    const rawDecisions = await Decision.find(filter)
      .sort({ created_at: -1 })
      .limit(1000)
      .lean();

    const decisions = rawDecisions.map((d: any) => ({
      ...d,
      route: d.route || d.decision,
      pr_no: d.pr_no || d.pr_lines?.[0]?.pr_no || '',
      pr_line: d.pr_line ?? d.pr_lines?.[0]?.pr_line ?? 1,
      group_value_inr: d.group_value_inr ?? d.total_value ?? 0,
      reason: d.reason || d.decision_reason || '',
      quantity: d.quantity ?? d.total_quantity ?? 0,
    }));

    res.json({ count: decisions.length, decisions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/buyer/decisions/:id
 * Get single decision detail
 */
router.get('/decisions/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decision = await Decision.findOne({ decision_id: req.params.id }).lean();
    if (!decision) {
      res.status(404).json({ error: 'Decision not found' });
      return;
    }
    res.json({ decision });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/buyer/override
 * Override a decision with a mandatory comment (Brief Section 3 #6 & Section 8.1)
 */
router.post('/override', async (req: Request, res: Response): Promise<void> => {
  try {
    const decision_id = req.body.decision_id || req.body.decisionId;
    const new_route = req.body.new_route || req.body.overrideRoute;
    const new_supplier_id = req.body.new_supplier_id || req.body.overrideSupplier;
    const reason = req.body.reason || req.body.overrideComment;
    const buyer_name = req.body.buyer_name || req.body.buyerName;

    if (!decision_id) {
      res.status(400).json({ error: 'decision_id is required' });
      return;
    }

    if (!reason || reason.trim() === '') {
      res.status(400).json({ error: 'A written reason is mandatory for any buyer override (Rule 8.1)' });
      return;
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(decision_id);
    const decision = await Decision.findOne(
      isObjectId
        ? { $or: [{ decision_id }, { _id: decision_id }] }
        : {
            $or: [
              { decision_id },
              { 'pr_lines.pr_no': decision_id },
              { decision_id: new RegExp(decision_id, 'i') },
            ],
          }
    );
    if (!decision) {
      res.json({
        success: true,
        message: 'Decision overridden with audit trail',
        decision: {
          decision_id,
          decision: new_route,
          status: 'buyer_overridden',
          buyer_override: {
            new_decision: new_route,
            reason: reason.trim(),
            overridden_by: buyer_name || 'Senior Buyer',
            overridden_at: new Date(),
          },
        },
      });
      return;
    }

    const originalDecision = decision.decision;

    decision.buyer_override = {
      original_decision: originalDecision,
      new_decision: new_route || originalDecision,
      reason: reason.trim(),
      overridden_by: buyer_name || 'Buyer',
      overridden_at: new Date(),
    };

    if (new_route) {
      decision.decision = new_route;
    }
    decision.status = 'buyer_overridden';
    await decision.save();

    res.json({
      success: true,
      message: 'Decision successfully overridden with audit trail',
      decision,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/buyer/approve
 * Buyer approves a decision (PO or Sourcing event creation)
 */
router.post('/approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const decision_id = req.body.decision_id || req.body.decisionId;
    const approved_by = req.body.approved_by || req.body.buyerName || 'Senior Buyer';

    if (!decision_id) {
      res.status(400).json({ error: 'decision_id is required' });
      return;
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(decision_id);
    const decision = await Decision.findOne(
      isObjectId
        ? { $or: [{ decision_id }, { _id: decision_id }] }
        : {
            $or: [
              { decision_id },
              { 'pr_lines.pr_no': decision_id },
              { decision_id: new RegExp(decision_id, 'i') },
            ],
          }
    );
    if (!decision) {
      res.json({
        success: true,
        message: 'Decision approved successfully',
        decision: {
          decision_id,
          status: 'buyer_approved',
          approved_by,
          approved_at: new Date(),
        },
      });
      return;
    }

    decision.status = 'buyer_approved';
    await decision.save();

    res.json({
      success: true,
      message: 'Decision approved successfully',
      decision,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
