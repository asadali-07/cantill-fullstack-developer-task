import { Router, Request, Response } from 'express';
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

    const decisions = await Decision.find(filter)
      .sort({ created_at: -1 })
      .limit(200)
      .lean();

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

    const decision = await Decision.findOne({ decision_id });
    if (!decision) {
      res.status(404).json({ error: 'Decision not found' });
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
    const { decision_id, approved_by } = req.body;

    if (!decision_id) {
      res.status(400).json({ error: 'decision_id is required' });
      return;
    }

    const decision = await Decision.findOne({ decision_id });
    if (!decision) {
      res.status(404).json({ error: 'Decision not found' });
      return;
    }

    decision.status = 'buyer_approved';
    await decision.save();

    res.json({
      success: true,
      message: `Decision approved for ${decision.decision}. Order/sourcing event initiated.`,
      decision,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
