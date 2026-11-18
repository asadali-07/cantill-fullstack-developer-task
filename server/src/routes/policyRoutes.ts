import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { PolicyVersion, IPolicyVersion } from '../models/PolicyVersion';
import { parsePolicyAmendmentWithGemini } from '../ai/policyParser';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * GET /api/policy/active
 * Returns the currently active procurement policy
 */
router.get('/active', async (_req: Request, res: Response): Promise<void> => {
  try {
    const active = await PolicyVersion.findOne({ is_active: true })
      .sort({ effective_date: -1 })
      .lean();

    if (!active) {
      res.status(404).json({ error: 'No active policy version found' });
      return;
    }

    res.json({ policy: active, ...active });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/policy/versions
 * List all policy versions with their amendment history
 */
router.get('/versions', async (_req: Request, res: Response): Promise<void> => {
  try {
    const versions = await PolicyVersion.find()
      .sort({ effective_date: -1 })
      .lean();

    res.json({ count: versions.length, versions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/policy/preview-amendment
 * Accepts natural language text OR an uploaded amendment document (PDF)
 * Returns a plain-English preview and structured diff using Gemini
 */
router.post(
  '/preview-amendment',
  upload.single('pdf'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      let amendmentText = req.body?.text || req.body?.amendmentText || '';

      if (req.file) {
        const parsed = await pdfParse(req.file.buffer);
        amendmentText = parsed.text;
      }

      if (!amendmentText || amendmentText.trim() === '') {
        res.status(400).json({ error: 'No amendment text or PDF document provided' });
        return;
      }

      // Fetch active policy to diff against
      const activePolicy = await PolicyVersion.findOne({ is_active: true })
        .sort({ effective_date: -1 })
        .lean();

      const currentRules = activePolicy?.rules || ({} as any);
      const currentVersion = activePolicy?.version || '5.0';

      // Parse with Gemini
      const proposed = await parsePolicyAmendmentWithGemini(
        amendmentText,
        currentRules,
        currentVersion
      );

      res.json({
        success: true,
        currentVersion,
        new_version: proposed.proposedVersion,
        proposed_policy: proposed.updatedRules,
        ...proposed,
      });
    } catch (err: any) {
      console.error('[Policy Preview Error]:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/policy/approve-amendment
 * On user approval, commits the new policy version to MongoDB and activates it (Rule 3)
 */
router.post('/approve-amendment', async (req: Request, res: Response): Promise<void> => {
  try {
    const version = req.body.version || req.body.new_version;
    const rules = req.body.rules || req.body.proposed_policy;
    const effectiveDate = req.body.effectiveDate || req.body.effective_date;
    const description = req.body.description || req.body.amendment_description;
    const summary = req.body.summary;
    const diff = req.body.diff;

    if (!version || !rules) {
      res.status(400).json({ error: 'Version and rules are required' });
      return;
    }

    // 1. Deactivate old versions
    await PolicyVersion.updateMany({}, { is_active: false });

    // 2. Create amendment record
    const amendmentRecord = {
      amendment_id: `AMD-${Date.now()}`,
      applied_at: new Date(),
      description: summary || description || `Amendment to version ${version}`,
      changes: (diff || []).reduce((acc: any, d: any) => {
        acc[d.field] = { before: d.oldValue, after: d.newValue };
        return acc;
      }, {}),
    };

    // 3. Create and activate the new policy version
    const newPolicy = await PolicyVersion.create({
      version,
      effective_date: effectiveDate ? new Date(effectiveDate) : new Date(),
      is_active: true,
      description: description || `Policy Version ${version} (Amended)`,
      rules,
      amendments: [amendmentRecord],
    });

    console.log(`[Policy Engine] Activated new policy version ${version}`);

    res.json({
      success: true,
      message: `Policy ${version} is now active. All subsequent PR evaluations will follow these rules.`,
      policy: newPolicy,
    });
  } catch (err: any) {
    console.error('[Policy Activation Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/policy/activate/:version
 * Rollback or switch to a specific version
 */
router.post('/activate/:version', async (req: Request, res: Response): Promise<void> => {
  try {
    const targetVersion = req.params.version;
    const policy = await PolicyVersion.findOne({ version: targetVersion });

    if (!policy) {
      res.status(404).json({ error: `Policy version ${targetVersion} not found` });
      return;
    }

    await PolicyVersion.updateMany({}, { is_active: false });
    policy.is_active = true;
    await policy.save();

    res.json({
      success: true,
      message: `Switched active policy to version ${targetVersion}`,
      policy,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
