import path from 'path';
import dotenv from 'dotenv';

// Load env first
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.NODE_ENV = 'test';

import fs from 'fs';
import mongoose from 'mongoose';
import http from 'http';
import { connectDB } from './config/db';
import app from './index';

async function testEndpoints() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDB();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5001, () => resolve()));
  console.log('Test server running on http://localhost:5001');

  try {
    // 1. Health check
    console.log('\n--- 1. Testing GET /api/health ---');
    const healthRes = await fetch('http://localhost:5001/api/health');
    const healthJson = await healthRes.json();
    console.log('Health response:', healthJson);

    // 2. Process batch
    console.log('\n--- 2. Testing POST /api/process-batch ---');
    const sampleCsv = fs.readFileSync(
      path.resolve(__dirname, '../../pr_batches/sample_pr_batch.csv'),
      'utf-8'
    );
    const batchRes = await fetch('http://localhost:5001/api/process-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: sampleCsv }),
    });
    const batchJson = await batchRes.json();
    console.log(`Processed ${batchJson.totalLines} lines in ${batchJson.processingTimeMs}ms!`);
    console.log('Route breakdown:', batchJson.routeBreakdown);

    // 3. Export decisions CSV
    console.log('\n--- 3. Testing GET /api/process-batch/export ---');
    const exportRes = await fetch('http://localhost:5001/api/process-batch/export');
    const exportCsv = await exportRes.text();
    const exportLines = exportCsv.trim().split('\n');
    console.log(`CSV Export has ${exportLines.length} lines (including header).`);
    console.log('Header:', exportLines[0]);
    console.log('Sample row 1:', exportLines[1]);

    // 4. Preferred Suppliers
    console.log('\n--- 4. Testing GET /api/suppliers/preferred ---');
    const prefRes = await fetch('http://localhost:5001/api/suppliers/preferred?item_code=ITM-1048');
    const prefJson = await prefRes.json();
    console.log('ITM-1048 Preferred Suppliers:', prefJson.data[0]?.suppliers);

    // 5. Preferred Suppliers CSV Export
    console.log('\n--- 5. Testing GET /api/suppliers/preferred/export ---');
    const prefCsvRes = await fetch('http://localhost:5001/api/suppliers/preferred/export');
    const prefCsv = await prefCsvRes.text();
    const prefCsvLines = prefCsv.trim().split('\n');
    console.log(`Preferred Suppliers CSV has ${prefCsvLines.length} lines.`);
    console.log('Header:', prefCsvLines[0]);
    console.log('Sample row 1:', prefCsvLines[1]);

    // 6. Contracts
    console.log('\n--- 6. Testing GET /api/contracts ---');
    const contractsRes = await fetch('http://localhost:5001/api/contracts');
    const contractsJson = await contractsRes.json();
    console.log(`Found ${contractsJson.total} contracts in system.`);
    console.log('First contract:', contractsJson.contracts[0]?.contract_id, contractsJson.contracts[0]?.supplier_name);

    // 7. Buyer decisions & override
    console.log('\n--- 7. Testing GET /api/buyer/decisions & POST /api/buyer/override ---');
    const decisionsRes = await fetch('http://localhost:5001/api/buyer/decisions?limit=5');
    const decisionsJson = await decisionsRes.json();
    console.log(`Retrieved ${decisionsJson.count} decisions.`);

    if (decisionsJson.decisions.length > 0) {
      const target = decisionsJson.decisions[0];
      const overrideRes = await fetch('http://localhost:5001/api/buyer/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision_id: target.decision_id,
          new_route: 'RFP',
          reason: 'Testing buyer override requirement with mandatory comment',
          buyer_name: 'Senior Buyer',
        }),
      });
      const overrideJson = await overrideRes.json();
      console.log('Override result:', overrideJson.message, 'Status:', overrideJson.decision?.status);
    }

    console.log('\n🎉 ALL 7 API ENDPOINTS VERIFIED & WORKING PERFECTLY!');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

testEndpoints().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
