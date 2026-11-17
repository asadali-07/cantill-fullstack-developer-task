import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import { runDecisionEngine } from './engine';
import { RawPRLine } from './clubber';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function runTest() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(mongoURI);
  console.log('Connected to MongoDB. Loading sample PR batch...');

  const batchPath = path.resolve(__dirname, '../../../pr_batches/sample_pr_batch.csv');
  const fileContent = fs.readFileSync(batchPath, 'utf-8');
  const records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

  const rawPRs: RawPRLine[] = records.map((r: any) => ({
    pr_no: r.pr_no,
    pr_line: parseInt(r.pr_line, 10),
    created_at: new Date(r.created_at),
    requester: r.requester,
    department: r.department,
    plant: r.plant,
    item_code: r.item_code || '',
    description: r.description,
    quantity: parseFloat(r.quantity),
    uom: r.uom,
    estimated_unit_price: r.estimated_unit_price ? parseFloat(r.estimated_unit_price) : undefined,
    need_by_date: new Date(r.need_by_date),
    urgency: r.urgency,
  }));

  console.log(`Processing batch of ${rawPRs.length} PR lines through Decision Engine...`);
  const startTime = Date.now();
  const { results, clubbedRequirements } = await runDecisionEngine(rawPRs);
  const elapsedMs = Date.now() - startTime;

  console.log(`\nDecision Engine finished in ${elapsedMs}ms!`);
  console.log(`Total PR lines processed: ${results.length}`);
  console.log(`Total Clubbed Requirements: ${clubbedRequirements.length}`);

  // Count decision breakdown
  const routeCounts: Record<string, number> = {};
  for (const res of results) {
    routeCounts[res.route] = (routeCounts[res.route] || 0) + 1;
  }
  console.log('\n--- Decision Route Breakdown ---');
  console.table(routeCounts);

  // Verify the 14 Worked Examples
  console.log('\n--- Verifying Worked Examples from Worked_Examples.pdf ---');

  const getResult = (prNo: string, line: number = 1) =>
    results.find((r) => r.pr_no === prNo && r.pr_line === line);

  const tests = [
    {
      name: 'Ex 1: Contract PO (PR-26-00019/1)',
      check: () => {
        const r = getResult('PR-26-00019');
        return (
          r?.route === 'CONTRACT_PO' &&
          r?.supplier_id === 'S001' &&
          Math.abs(r?.group_value_inr - 137531) < 50
        );
      },
      detail: (r: any) => `Route: ${r?.route}, Supplier: ${r?.supplier_id}, Value: ${r?.group_value_inr}`,
    },
    {
      name: 'Ex 2: Contract in PDF only (PR-26-00045/1 -> RC-2026-031)',
      check: () => {
        const r = getResult('PR-26-00045');
        return (
          r?.route === 'CONTRACT_PO' &&
          r?.supplier_id === 'S021' &&
          Math.abs(r?.group_value_inr - 26829) < 50
        );
      },
      detail: (r: any) => `Route: ${r?.route}, Supplier: ${r?.supplier_id}, Value: ${r?.group_value_inr}`,
    },
    {
      name: 'Ex 3: Contract ceiling nearly used up (PR-26-00004 & PR-26-00026 -> RFQ)',
      check: () => {
        const r1 = getResult('PR-26-00004');
        const r2 = getResult('PR-26-00026');
        return (
          r1?.route === 'RFQ' &&
          r1?.group_id === r2?.group_id &&
          Math.abs(r1?.group_value_inr - 220256) < 200
        );
      },
      detail: (r: any) => `Route: ${r?.route}, Group: ${r?.group_id}, Value: ${r?.group_value_inr}, Suggested: ${r?.suggested_supplier_ids}`,
    },
    {
      name: 'Ex 4: Two contracts for same item (PR-26-00034/1 & PR-26-00032/1 -> CONTRACT_PO S007)',
      check: () => {
        const r = getResult('PR-26-00034');
        return r?.route === 'CONTRACT_PO' && r?.supplier_id === 'S007';
      },
      detail: (r: any) => `Route: ${r?.route}, Supplier: ${r?.supplier_id}, Price: ${r?.unit_price}`,
    },
    {
      name: 'Ex 5: Split PRs clubbed into 1 requirement (PR-26-00146, 00144, 00145 -> SPOT_PO S024)',
      check: () => {
        const r1 = getResult('PR-26-00146');
        const r2 = getResult('PR-26-00144');
        const r3 = getResult('PR-26-00145');
        return (
          r1?.group_id === r2?.group_id &&
          r2?.group_id === r3?.group_id &&
          r1?.route === 'SPOT_PO' &&
          r1?.supplier_id === 'S024'
        );
      },
      detail: (r: any) => `Route: ${r?.route}, Group: ${r?.group_id}, Supplier: ${r?.supplier_id}, Value: ${r?.group_value_inr}`,
    },
    {
      name: 'Ex 6: Same item, different plants not clubbed (PR-26-00106 vs PR-26-00103)',
      check: () => {
        const r1 = getResult('PR-26-00106');
        const r2 = getResult('PR-26-00103');
        return r1?.group_id !== r2?.group_id && r1?.route === 'SPOT_PO' && r2?.route === 'SPOT_PO';
      },
      detail: (r1: any, r2: any) => `G1: ${r1?.group_id} (${r1?.route}), G2: ${r2?.group_id} (${r2?.route})`,
    },
    {
      name: 'Ex 7: Free-text item matched (PR-26-00088 "hyd hose 1/2 inch 2 wire" -> ITM-1035 SPOT_PO)',
      check: () => {
        const r = getResult('PR-26-00088');
        return r?.resolved_item_code === 'ITM-1035' && r?.route === 'SPOT_PO';
      },
      detail: (r: any) => `Resolved: ${r?.resolved_item_code}, Route: ${r?.route}, Supplier: ${r?.supplier_id}`,
    },
    {
      name: 'Ex 8: Emergency PO (PR-26-00059 -> EMERGENCY_PO S014)',
      check: () => {
        const r = getResult('PR-26-00059');
        return r?.route === 'EMERGENCY_PO' && r?.supplier_id === 'S014';
      },
      detail: (r: any) => `Route: ${r?.route}, Supplier: ${r?.supplier_id}, Value: ${r?.group_value_inr}`,
    },
    {
      name: 'Ex 9: RFQ above PO limit (PR-26-00089 CMM calibration service -> RFQ)',
      check: () => {
        const r = getResult('PR-26-00089');
        return r?.route === 'RFQ';
      },
      detail: (r: any) => `Route: ${r?.route}, Value: ${r?.group_value_inr}, Suggested: ${r?.suggested_supplier_ids}`,
    },
    {
      name: 'Ex 10: RFQ small but never bought (PR-26-00050 -> RFQ)',
      check: () => {
        const r = getResult('PR-26-00050');
        return r?.route === 'RFQ';
      },
      detail: (r: any) => `Route: ${r?.route}, Value: ${r?.group_value_inr}, Suggested: ${r?.suggested_supplier_ids}`,
    },
    {
      name: 'Ex 11: RFP (PR-26-00100 >= ₹10 lakh -> RFP)',
      check: () => {
        const r = getResult('PR-26-00100');
        return r?.route === 'RFP';
      },
      detail: (r: any) => `Route: ${r?.route}, Value: ${r?.group_value_inr}, Suggested: ${r?.suggested_supplier_ids}`,
    },
    {
      name: 'Ex 12: Capex (PR-26-00047 eot crane 5 ton -> CAPEX_SOURCING)',
      check: () => {
        const r = getResult('PR-26-00047');
        return r?.route === 'CAPEX_SOURCING';
      },
      detail: (r: any) => `Route: ${r?.route}, Value: ${r?.group_value_inr}, Suggested: ${r?.suggested_supplier_ids}`,
    },
    {
      name: 'Ex 13: New item (PR-26-00170 Drinking water purifier -> NEW_ITEM_SOURCING)',
      check: () => {
        const r = getResult('PR-26-00170');
        return (
          r?.resolved_item_code === 'NEW' &&
          r?.route === 'NEW_ITEM_SOURCING' &&
          r?.suggested_supplier_ids === ''
        );
      },
      detail: (r: any) => `Resolved: ${r?.resolved_item_code}, Route: ${r?.route}, Value: ${r?.group_value_inr}`,
    },
    {
      name: 'Ex 14: PO consolidation (PR-26-00034 & PR-26-00031 share PO)',
      check: () => {
        const r1 = getResult('PR-26-00034');
        const r2 = getResult('PR-26-00031');
        return r1?.po_id && r1?.po_id === r2?.po_id;
      },
      detail: (r1: any, r2: any) => `PO1: ${r1?.po_id}, PO2: ${r2?.po_id}`,
    },
  ];

  let passed = 0;
  for (const t of tests) {
    const success = t.check();
    if (success) {
      console.log(`✅ ${t.name} -> PASSED`);
      passed++;
    } else {
      console.log(`❌ ${t.name} -> FAILED`);
      const r = getResult(t.name.match(/PR-26-\d+/)?.[0] || '');
      console.log(`   ${t.detail(r, getResult('PR-26-00103'))}`);
    }
  }

  console.log(`\nResults: ${passed} / ${tests.length} tests passed.`);

  // Test Preferred Supplier Ranking (Worked Examples Page 5)
  console.log('\n--- Verifying Preferred Supplier Lists (Worked Examples Page 5) ---');
  const asOfNov1 = new Date('2026-11-01T00:00:00.000Z');
  const [dbItems, dbSuppliers, dbPOs, dbContracts, dbLines] = await Promise.all([
    mongoose.model('Item').find().lean(),
    mongoose.model('Supplier').find().lean(),
    mongoose.model('POHistory').find().lean(),
    mongoose.model('Contract').find().lean(),
    mongoose.model('ContractLine').find().lean(),
  ]);

  const { getPreferredSuppliers } = await import('./supplierRanker');

  const checkSupplierRank = (itemCode: string, expectedRanks: string[]) => {
    const list = getPreferredSuppliers(
      itemCode,
      asOfNov1,
      dbSuppliers as any,
      dbPOs as any,
      dbContracts as any,
      dbLines as any
    );
    const actual = list.map((s) => s.supplier_id).slice(0, expectedRanks.length);
    const match = JSON.stringify(actual) === JSON.stringify(expectedRanks);
    console.log(
      `${match ? '✅' : '❌'} Preferred suppliers for ${itemCode}: Expected [${expectedRanks.join(', ')}], Got [${actual.join(', ')}]`
    );
    return match;
  };

  checkSupplierRank('ITM-1048', ['S029', 'S030']);
  checkSupplierRank('ITM-1036', ['S023', 'S022', 'S024']);
  checkSupplierRank('ITM-1016', ['S009', 'S010']);

  await mongoose.disconnect();
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
