import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Contract } from '../models/Contract';
import { ContractLine } from '../models/ContractLine';
import { Supplier } from '../models/Supplier';
import { PDF_CONTRACTS } from '../engine/contracts';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
if (!process.env.MONGODB_URI) {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
}

async function repair() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cantill';
  console.log('[Repair] Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('[Repair] Connected successfully.');

  const rootDir = path.resolve(__dirname, '../../..');
  const contractsCSVPath = path.join(rootDir, 'contracts', 'contract_register.csv');
  const linesCSVPath = path.join(rootDir, 'contracts', 'contract_lines.csv');

  if (fs.existsSync(contractsCSVPath)) {
    const contractsRaw = parse(fs.readFileSync(contractsCSVPath, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`[Repair] Synchronizing ${contractsRaw.length} contracts from contract_register.csv...`);
    for (const row of contractsRaw) {
      await Contract.findOneAndUpdate(
        { contract_id: row.contract_id },
        {
          contract_id: row.contract_id,
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name,
          start_date: new Date(row.start_date),
          end_date: new Date(row.end_date),
          value_cap: parseFloat(row.value_cap),
          consumed_value: parseFloat(row.consumed_value),
        },
        { upsert: true, new: true }
      );
    }
  }

  if (fs.existsSync(linesCSVPath)) {
    const linesRaw = parse(fs.readFileSync(linesCSVPath, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`[Repair] Synchronizing ${linesRaw.length} contract lines from contract_lines.csv...`);
    // Group lines by contract_id
    const linesByContract = new Map<string, any[]>();
    for (const row of linesRaw) {
      if (!linesByContract.has(row.contract_id)) {
        linesByContract.set(row.contract_id, []);
      }
      linesByContract.get(row.contract_id)!.push({
        contract_id: row.contract_id,
        item_code: row.item_code,
        description: row.description,
        uom: row.uom,
        rate: parseFloat(row.rate),
      });
    }

    for (const [contractId, lines] of linesByContract.entries()) {
      try {
        await ContractLine.deleteMany({ contract_id: contractId });
        await ContractLine.insertMany(lines);
      } catch (err: any) {
        console.warn(`[Repair] Retrying lines for ${contractId}...`);
        await new Promise((r) => setTimeout(r, 1000));
        await ContractLine.deleteMany({ contract_id: contractId });
        await ContractLine.insertMany(lines);
      }
    }
  }

  // Ensure PDF_CONTRACTS (RC-2026-031, RC-2026-033) exist in MongoDB
  for (const item of PDF_CONTRACTS) {
    const existing = await Contract.findOne({ contract_id: item.contract.contract_id });
    if (!existing) {
      console.log(`[Repair] Inserting PDF contract: ${item.contract.contract_id}`);
      await Contract.create(item.contract);
      await ContractLine.deleteMany({ contract_id: item.contract.contract_id });
      await ContractLine.insertMany(item.lines);
    }
  }

  const allContracts = await Contract.find().lean();
  console.log(`[Repair] Total contracts in DB now: ${allContracts.length}`);
  for (const c of allContracts) {
    const lineCount = await ContractLine.countDocuments({ contract_id: c.contract_id });
    console.log(`  - ${c.contract_id} | ${c.supplier_name} (${c.supplier_id}) | Cap: ₹${c.value_cap} | Consumed: ₹${c.consumed_value} | Lines: ${lineCount}`);
  }

  await mongoose.disconnect();
  console.log('[Repair] Done!');
}

repair().catch((err) => {
  console.error('[Repair Error]:', err);
  process.exit(1);
});
