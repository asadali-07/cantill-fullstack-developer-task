import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import {
  Item,
  Supplier,
  Plant,
  Contract,
  ContractLine,
  POHistory,
  PurchaseRequisition,
  PolicyVersion,
  Decision,
} from '../models';
import { defaultPolicy } from './defaultPolicy';

/**
 * Attempt to load .env from several candidate locations.
 */
function loadEnv(): void {
  const candidates = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log(`[Seed] Loaded .env from ${envPath}`);
      return;
    }
  }
  console.warn('[Seed] No .env file found, relying on environment variables');
}

/**
 * Find the project root by looking for the `master_data` directory.
 */
function findProjectRoot(): string {
  const candidates = [
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '../..'),
    path.resolve(__dirname, '../../../..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'master_data'))) {
      console.log(`[Seed] Project root detected at ${dir}`);
      return dir;
    }
  }
  throw new Error(
    '[Seed] Could not find project root (looking for master_data/ directory). ' +
      'Candidates checked: ' +
      candidates.join(', ')
  );
}

/**
 * Read and parse a CSV file. Returns an array of objects keyed by header names.
 */
function readCSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

async function seed(): Promise<void> {
  loadEnv();

  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cantill';
  console.log(`[Seed] Connecting to MongoDB at ${mongoURI}`);

  await mongoose.connect(mongoURI);
  console.log('[Seed] MongoDB connected');

  const projectRoot = findProjectRoot();

  // Drop all collections for a clean slate
  console.log('[Seed] Dropping existing collections...');
  const collections = (await mongoose.connection.db?.collections()) || [];
  for (const collection of collections) {
    await collection.drop().catch(() => {
      // Ignore "namespace not found" errors
    });
  }
  console.log('[Seed] All collections dropped');

  // ─── 1. Items ───────────────────────────────────────────────
  const itemsCSV = readCSV(path.join(projectRoot, 'master_data', 'item_master.csv'));
  const items = itemsCSV.map((row) => ({
    item_code: row.item_code,
    description: row.description,
    uom: row.uom,
    category: row.category,
    item_type: row.item_type,
    standard_price: parseFloat(row.standard_price),
  }));
  await Item.insertMany(items);
  console.log(`[Seed] Items: ${items.length} records inserted`);

  // ─── 2. Suppliers ──────────────────────────────────────────
  const suppliersCSV = readCSV(path.join(projectRoot, 'master_data', 'supplier_master.csv'));
  const suppliers = suppliersCSV.map((row) => ({
    supplier_id: row.supplier_id,
    name: row.name,
    city: row.city,
    categories: row.categories.split(';').map((c: string) => c.trim()),
    status: row.status,
    on_time_pct: parseFloat(row.on_time_pct),
    quality_rating: parseFloat(row.quality_rating),
  }));
  await Supplier.insertMany(suppliers);
  console.log(`[Seed] Suppliers: ${suppliers.length} records inserted`);

  // ─── 3. Plants ─────────────────────────────────────────────
  const plantsCSV = readCSV(path.join(projectRoot, 'master_data', 'plants.csv'));
  const plants = plantsCSV.map((row) => ({
    plant: row.plant,
    name: row.name,
  }));
  await Plant.insertMany(plants);
  console.log(`[Seed] Plants: ${plants.length} records inserted`);

  // ─── 4. PO History ─────────────────────────────────────────
  const poHistoryCSV = readCSV(path.join(projectRoot, 'master_data', 'po_history.csv'));
  const poHistory = poHistoryCSV.map((row) => ({
    po_number: row.po_number,
    po_date: new Date(row.po_date),
    supplier_id: row.supplier_id,
    item_code: row.item_code,
    quantity: parseFloat(row.quantity),
    uom: row.uom,
    unit_price: parseFloat(row.unit_price),
    plant: row.plant,
    delivered_on_time: row.delivered_on_time === 'True' || row.delivered_on_time === 'true',
  }));
  await POHistory.insertMany(poHistory);
  console.log(`[Seed] PO History: ${poHistory.length} records inserted`);

  // ─── 5. Contracts ──────────────────────────────────────────
  const contractsCSV = readCSV(path.join(projectRoot, 'contracts', 'contract_register.csv'));
  const contracts = contractsCSV.map((row) => ({
    contract_id: row.contract_id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    start_date: new Date(row.start_date),
    end_date: new Date(row.end_date),
    value_cap: parseFloat(row.value_cap),
    consumed_value: parseFloat(row.consumed_value),
  }));
  await Contract.insertMany(contracts);
  console.log(`[Seed] Contracts: ${contracts.length} records inserted`);

  // ─── 6. Contract Lines ─────────────────────────────────────
  const contractLinesCSV = readCSV(path.join(projectRoot, 'contracts', 'contract_lines.csv'));
  const contractLines = contractLinesCSV.map((row) => ({
    contract_id: row.contract_id,
    item_code: row.item_code,
    description: row.description,
    uom: row.uom,
    rate: parseFloat(row.rate),
  }));
  await ContractLine.insertMany(contractLines);
  console.log(`[Seed] Contract Lines: ${contractLines.length} records inserted`);

  // ─── 7. Sample PR Batch (validate only, do not seed) ──────
  const prBatchPath = path.join(projectRoot, 'pr_batches', 'sample_pr_batch.csv');
  if (fs.existsSync(prBatchPath)) {
    const prBatchCSV = readCSV(prBatchPath);
    console.log(`[Seed] Sample PR Batch: file exists with ${prBatchCSV.length} records (NOT seeded — PRs are uploaded at runtime)`);
  } else {
    console.warn('[Seed] Sample PR Batch: file not found at', prBatchPath);
  }

  // ─── 8. Default Policy v5.0 ────────────────────────────────
  await PolicyVersion.create(defaultPolicy);
  console.log('[Seed] Policy v5.0 seeded');

  // ─── Summary ───────────────────────────────────────────────
  console.log('\n[Seed] ══════════════════════════════════════');
  console.log('[Seed] Seed complete! Collection counts:');
  console.log(`  Items:          ${await Item.countDocuments()}`);
  console.log(`  Suppliers:      ${await Supplier.countDocuments()}`);
  console.log(`  Plants:         ${await Plant.countDocuments()}`);
  console.log(`  PO History:     ${await POHistory.countDocuments()}`);
  console.log(`  Contracts:      ${await Contract.countDocuments()}`);
  console.log(`  Contract Lines: ${await ContractLine.countDocuments()}`);
  console.log(`  PRs:            ${await PurchaseRequisition.countDocuments()}`);
  console.log(`  Policies:       ${await PolicyVersion.countDocuments()}`);
  console.log(`  Decisions:      ${await Decision.countDocuments()}`);
  console.log('[Seed] ══════════════════════════════════════\n');

  await mongoose.disconnect();
  console.log('[Seed] MongoDB disconnected. Done.');
}

seed().catch((err) => {
  console.error('[Seed] Fatal error:', err);
  process.exit(1);
});
