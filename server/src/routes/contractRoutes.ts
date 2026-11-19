import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { Contract, IContract } from '../models/Contract';
import { ContractLine, IContractLine } from '../models/ContractLine';
import { Supplier } from '../models/Supplier';
import { getAllContractsWithPDFs } from '../engine/contracts';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * GET /api/contracts
 * Returns all contracts with consumed value, ceiling and remaining room
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [dbContracts, dbLines] = await Promise.all([
      Contract.find().sort({ start_date: -1 }).lean() as unknown as Promise<IContract[]>,
      ContractLine.find().lean() as unknown as Promise<IContractLine[]>,
    ]);

    const { contracts, contractLines } = getAllContractsWithPDFs(dbContracts, dbLines);

    // Sort all contracts by start_date descending so newest/uploaded contracts show up first
    contracts.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

    const contractsWithDetails = contracts.map((c) => {
      const lines = contractLines.filter((l) => l.contract_id === c.contract_id);
      const remaining = Math.max(0, c.value_cap - (c.consumed_value || 0));
      const pctUsed = c.value_cap > 0 ? Math.round(((c.consumed_value || 0) / c.value_cap) * 100) : 0;

      return {
        ...c,
        contract_ref: c.contract_id,
        contract_id: c.contract_id,
        ceiling_value: c.value_cap,
        value_cap: c.value_cap,
        cumulative_spend: c.consumed_value || 0,
        consumed_value: c.consumed_value || 0,
        valid_from: c.start_date,
        start_date: c.start_date,
        valid_to: c.end_date,
        end_date: c.end_date,
        plant: (c as any).plant || 'ALL (PUN1, CHN1)',
        remaining_ceiling: remaining,
        pct_used: pctUsed,
        lines_count: lines.length,
        lines: lines.map((l) => ({
          ...l,
          contracted_price: l.rate,
          rate: l.rate,
          item_description: l.description,
          description: l.description,
        })),
      };
    });

    res.json({ total: contractsWithDetails.length, contracts: contractsWithDetails });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/contracts/manual
 * Add a contract manually
 */
router.post('/manual', async (req: Request, res: Response): Promise<void> => {
  try {
    const { contract, lines } = req.body;

    if (!contract?.contract_id || !contract?.supplier_id || !contract?.value_cap) {
      res.status(400).json({ error: 'Missing required contract fields' });
      return;
    }

    const newContract = await Contract.create({
      ...contract,
      start_date: new Date(contract.start_date),
      end_date: new Date(contract.end_date),
      consumed_value: contract.consumed_value || 0,
    });

    if (Array.isArray(lines) && lines.length > 0) {
      const lineDocs = lines.map((l: any) => ({
        ...l,
        contract_id: contract.contract_id,
      }));
      await ContractLine.insertMany(lineDocs);
    }

    res.json({ success: true, contract: newContract });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/contracts/upload-pdf
 * Extract contract info from PDF and persist to register (Brief Section 3 #8)
 */
router.post(
  '/upload-pdf',
  upload.single('pdf'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No PDF file uploaded' });
        return;
      }

      const pdfData = await pdfParse(req.file.buffer);
      const text = pdfData.text;

      // 1. Extract Contract No. - prefer filename if it contains a contract ref (e.g. RC-2026-049), else PDF text
      const fileMatch = req.file.originalname?.match(/(RC-\d{4}-\d{3})/i);
      const contractNoMatch = text.match(/Contract\s+No\.?\s*([A-Z0-9-]+)/i);
      const contractId = fileMatch
        ? fileMatch[1].toUpperCase()
        : contractNoMatch
        ? contractNoMatch[1].trim()
        : `RC-${Date.now()}`;

      // 2. Extract Supplier ID & Name
      const suppIdMatch = text.match(/Supplier\s+ID\s*([A-Z0-9]+)/i);
      const supplierId = suppIdMatch ? suppIdMatch[1].trim() : 'S001';

      let supplierName = '';
      const suppNameMatch = text.match(/(?:and|between)\s+([^,]+?),\s*([^\n(]+?)\s*\(Supplier/is);
      if (suppNameMatch) {
        supplierName = suppNameMatch[1].trim();
      }

      // Check master Supplier model to get canonical supplier name
      const dbSupplier = await Supplier.findOne({ supplier_id: supplierId }).lean();
      if (dbSupplier && dbSupplier.name) {
        supplierName = dbSupplier.name;
      }
      if (!supplierName) {
        supplierName = 'Unknown Supplier';
      }

      // 3. Extract Term dates: valid from YYYY-MM-DD to YYYY-MM-DD
      const datesMatch = text.match(/valid\s+from\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s+to\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
      const startDate = datesMatch ? new Date(datesMatch[1]) : new Date();
      const endDate = datesMatch ? new Date(datesMatch[2]) : new Date(Date.now() + 365 * 24 * 3600 * 1000);

      // 4. Extract Value ceiling: INR XX,XX,XXX
      const ceilingMatch = text.match(/exceed\s+INR\s+([0-9,]+)/i);
      const valueCap = ceilingMatch ? parseFloat(ceilingMatch[1].replace(/,/g, '')) : 1000000;

      // 5. Extract Items & Rates from Schedule A table (handles dense text without spaces from pdf-parse)
      const lines: any[] = [];
      const itemPattern = /(\d+)\s*(ITM-\d+)\s*(.+?)\s*(NOS|KG|MTR|LTR|CYL|BRL|BKT|SET|PAIR|ROL|REAM|MON|QTR|JOB)\s*([0-9,]+(?:\.[0-9]+)?)/gi;
      let match;
      while ((match = itemPattern.exec(text)) !== null) {
        lines.push({
          contract_id: contractId,
          item_code: match[2],
          description: match[3].trim(),
          uom: match[4],
          rate: parseFloat(match[5].replace(/,/g, '')),
        });
      }

      // 6. Preserve existing spend if updating an existing contract
      const existing = await Contract.findOne({ contract_id: contractId }).lean();
      const consumedValue = existing ? (existing.consumed_value ?? 0) : 0;

      // 7. Upsert into MongoDB
      const updatedContract = await Contract.findOneAndUpdate(
        { contract_id: contractId },
        {
          contract_id: contractId,
          supplier_id: supplierId,
          supplier_name: supplierName,
          start_date: startDate,
          end_date: endDate,
          value_cap: valueCap,
          consumed_value: consumedValue,
        },
        { upsert: true, new: true }
      );

      // 8. Insert or replace line items
      if (lines.length > 0) {
        await ContractLine.deleteMany({ contract_id: contractId });
        await ContractLine.insertMany(lines);
      }

      res.json({
        success: true,
        message: `Contract ${contractId} registered successfully with ${lines.length} lines for ${supplierName}`,
        contract: updatedContract,
        extracted: {
          contract_id: contractId,
          supplier_id: supplierId,
          supplier_name: supplierName,
          start_date: startDate,
          end_date: endDate,
          value_cap: valueCap,
          itemsCount: lines.length,
          lines,
        },
      });
    } catch (err: any) {
      console.error('[Contract PDF Parse Error]:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
