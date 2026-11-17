import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { Contract, IContract } from '../models/Contract';
import { ContractLine, IContractLine } from '../models/ContractLine';
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

    const contractsWithDetails = contracts.map((c) => {
      const lines = contractLines.filter((l) => l.contract_id === c.contract_id);
      const remaining = Math.max(0, c.value_cap - (c.consumed_value || 0));
      const pctUsed = c.value_cap > 0 ? Math.round(((c.consumed_value || 0) / c.value_cap) * 100) : 0;

      return {
        ...c,
        remaining_ceiling: remaining,
        pct_used: pctUsed,
        lines_count: lines.length,
        lines,
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
 * Extract contract info from PDF and add to register (Brief Section 3 #8)
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

      // Extract Contract No.
      const contractNoMatch = text.match(/Contract\s+No\.?\s*([A-Z0-9-]+)/i);
      const contractId = contractNoMatch ? contractNoMatch[1] : `RC-${Date.now()}`;

      // Extract Supplier ID & Name
      const supplierMatch = text.match(/between\s+Corvo[^\n]+and\s+([^,]+),\s*([^\n(]+)\(Supplier ID\s*([A-Z0-9]+)\)/i);
      const supplierName = supplierMatch ? supplierMatch[1].trim() : 'Unknown Supplier';
      const supplierId = supplierMatch ? supplierMatch[3].trim() : 'S001';

      // Extract Term dates: valid from YYYY-MM-DD to YYYY-MM-DD
      const datesMatch = text.match(/valid\s+from\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s+to\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
      const startDate = datesMatch ? new Date(datesMatch[1]) : new Date();
      const endDate = datesMatch ? new Date(datesMatch[2]) : new Date(Date.now() + 365 * 24 * 3600 * 1000);

      // Extract Value ceiling: INR XX,XX,XXX
      const ceilingMatch = text.match(/exceed\s+INR\s+([0-9,]+)/i);
      const valueCap = ceilingMatch ? parseFloat(ceilingMatch[1].replace(/,/g, '')) : 1000000;

      // Extract Items & Rates from Schedule A table
      // e.g. 1 ITM-1036 Pneumatic cylinder 50x100 NOS 3,537.76
      const lines: any[] = [];
      const itemPattern = /(\d+)\s+(ITM-\d+)\s+([A-Za-z0-9\s/.-]+?)\s+(NOS|KG|MTR|LTR|CYL|BRL|BKT|SET|PAIR|ROL|REAM|MON|QTR|JOB)\s+([0-9,]+(?:\.[0-9]+)?)/g;
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

      // Upsert into MongoDB
      await Contract.findOneAndUpdate(
        { contract_id: contractId },
        {
          contract_id: contractId,
          supplier_id: supplierId,
          supplier_name: supplierName,
          start_date: startDate,
          end_date: endDate,
          value_cap: valueCap,
          consumed_value: 0,
        },
        { upsert: true, new: true }
      );

      if (lines.length > 0) {
        await ContractLine.deleteMany({ contract_id: contractId });
        await ContractLine.insertMany(lines);
      }

      res.json({
        success: true,
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
