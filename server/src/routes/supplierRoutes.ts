import { Router, Request, Response } from 'express';
import { Supplier, ISupplier } from '../models/Supplier';
import { Item, IItem } from '../models/Item';
import { POHistory, IPOHistory } from '../models/POHistory';
import { Contract, IContract } from '../models/Contract';
import { ContractLine, IContractLine } from '../models/ContractLine';
import { PolicyVersion } from '../models/PolicyVersion';
import {
  getPreferredSuppliers,
  generatePreferredSuppliersExport,
} from '../engine/supplierRanker';
import { generatePreferredSuppliersCSV } from '../utils/csvExport';

const router = Router();

/**
 * GET /api/suppliers
 * List all suppliers
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const suppliers = await Supplier.find().sort({ supplier_id: 1 }).lean();
    res.json({ suppliers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/suppliers/preferred
 * Returns preferred suppliers for all items as of a chosen date
 */
router.get('/preferred', async (req: Request, res: Response): Promise<void> => {
  try {
    const asOfDate = req.query.date ? new Date(req.query.date as string) : new Date('2026-11-01');
    const itemCode = req.query.item_code as string | undefined;

    const [items, suppliers, poHistory, contracts, contractLines, activePolicy] =
      await Promise.all([
        (itemCode ? Item.find({ item_code: itemCode }).lean() : Item.find().lean()) as unknown as Promise<IItem[]>,
        Supplier.find().lean() as unknown as Promise<ISupplier[]>,
        POHistory.find().lean() as unknown as Promise<IPOHistory[]>,
        Contract.find().lean() as unknown as Promise<IContract[]>,
        ContractLine.find().lean() as unknown as Promise<IContractLine[]>,
        PolicyVersion.findOne({ is_active: true }).lean(),
      ]);

    const weights = activePolicy?.rules?.preferred_supplier_weights;

    const results = items.map((item) => {
      const preferred = getPreferredSuppliers(
        item.item_code,
        asOfDate,
        suppliers,
        poHistory,
        contracts,
        contractLines,
        weights
      );
      return {
        item_code: item.item_code,
        description: item.description,
        category: item.category,
        suppliers: preferred.slice(0, 3),
      };
    });

    res.json({ asOfDate, totalItems: results.length, data: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/suppliers/preferred/export
 * Downloads the preferred supplier CSV:
 * item_code,rank,supplier_id,reference_price
 */
router.get('/preferred/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const asOfDate = req.query.date ? new Date(req.query.date as string) : new Date('2026-11-01');
    const filename = (req.query.filename as string) || 'preferred_suppliers.csv';

    const [items, suppliers, poHistory, contracts, contractLines, activePolicy] =
      await Promise.all([
        Item.find().lean() as unknown as Promise<IItem[]>,
        Supplier.find().lean() as unknown as Promise<ISupplier[]>,
        POHistory.find().lean() as unknown as Promise<IPOHistory[]>,
        Contract.find().lean() as unknown as Promise<IContract[]>,
        ContractLine.find().lean() as unknown as Promise<IContractLine[]>,
        PolicyVersion.findOne({ is_active: true }).lean(),
      ]);

    const weights = activePolicy?.rules?.preferred_supplier_weights;

    const rows = generatePreferredSuppliersExport(
      items,
      asOfDate,
      suppliers,
      poHistory,
      contracts,
      contractLines,
      3,
      weights
    );

    const csvOutput = generatePreferredSuppliersCSV(rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvOutput);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
