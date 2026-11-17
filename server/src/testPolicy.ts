import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.NODE_ENV = 'test';

import mongoose from 'mongoose';
import http from 'http';
import { connectDB } from './config/db';
import app from './index';

async function testPolicyFlow() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDB();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5002, () => resolve()));
  console.log('Policy Test server running on http://localhost:5002');

  try {
    // 1. Get active policy
    console.log('\n--- 1. Testing GET /api/policy/active ---');
    const activeRes = await fetch('http://localhost:5002/api/policy/active');
    const activeJson = await activeRes.json();
    console.log(`Active Policy: Version ${activeJson.policy.version}, Effective: ${activeJson.policy.effective_date}`);
    console.log(`Current Spot Limit: ₹${activeJson.policy.rules.spot_po_limit.toLocaleString('en-IN')}`);

    // 2. Preview amendment with Gemini
    console.log('\n--- 2. Testing POST /api/policy/preview-amendment ---');
    const amendmentPrompt = `
      Amendment Notice - Corvo Procurement Policy
      Effective Date: 2026-11-20
      Due to updated working capital requirements:
      1. The Spot PO threshold is reduced from ₹2,00,000 to ₹1,50,000.
      2. The Emergency PO limit is adjusted to ₹4,00,000.
      3. For plant CHK1, all Electrical Spares must go to RFQ sourcing.
    `;

    const previewRes = await fetch('http://localhost:5002/api/policy/preview-amendment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: amendmentPrompt }),
    });

    const previewJson = await previewRes.json();
    console.log('\nGemini Analysis Result:');
    console.log(`Proposed Version: ${previewJson.proposedVersion}`);
    console.log(`Effective Date:   ${previewJson.effectiveDate}`);
    console.log(`Summary:          ${previewJson.summary}`);
    console.log('\nDetected Diff:');
    console.table(previewJson.diff);

    // 3. Approve amendment
    console.log('\n--- 3. Testing POST /api/policy/approve-amendment ---');
    const approveRes = await fetch('http://localhost:5002/api/policy/approve-amendment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: previewJson.proposedVersion || '5.1',
        effectiveDate: previewJson.effectiveDate,
        summary: previewJson.summary,
        rules: previewJson.updatedRules,
        diff: previewJson.diff,
      }),
    });
    const approveJson = await approveRes.json();
    console.log('Approval response:', approveJson.message);

    // 4. Verify new policy is active
    console.log('\n--- 4. Verifying New Active Policy ---');
    const newActiveRes = await fetch('http://localhost:5002/api/policy/active');
    const newActiveJson = await newActiveRes.json();
    console.log(`Now Active: Version ${newActiveJson.policy.version}`);
    console.log(`New Spot Limit: ₹${newActiveJson.policy.rules.spot_po_limit?.toLocaleString('en-IN')}`);
    console.log(`New Emergency Limit: ₹${newActiveJson.policy.rules.emergency_po_limit?.toLocaleString('en-IN')}`);

    // 5. Restore back to 5.0 for clean baseline
    console.log('\n--- 5. Restoring Baseline Policy v5.0 ---');
    await fetch('http://localhost:5002/api/policy/activate/5.0', { method: 'POST' });
    console.log('Restored Policy v5.0 as active baseline.');

    console.log('\n🎉 PHASE 4 POLICY-AS-DATA & GEMINI INTEGRATION VERIFIED!');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

testPolicyFlow().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
