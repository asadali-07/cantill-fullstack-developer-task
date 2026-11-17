import { IContract } from '../models/Contract';
import { IContractLine } from '../models/ContractLine';
import { ISupplier } from '../models/Supplier';

export interface ApplicableContractResult {
  contract: IContract | null;
  contractLine: IContractLine | null;
  rate: number | null;
  canBeUsed: boolean; // Has enough ceiling left
  lowestRateAmongAllApplicable: number | null; // For valuation rule 3.1
  reason?: string;
}

/**
 * Hardcoded definitions for contracts that were signed after the register update (31 Oct 2026)
 * and exist as signed PDFs in contracts/pdf/ (Section 4.4).
 * If they are already in the DB, DB takes precedence.
 */
export const PDF_CONTRACTS: {
  contract: Omit<IContract, '_id' | 'createdAt' | 'updatedAt'>;
  lines: Omit<IContractLine, '_id' | 'createdAt' | 'updatedAt'>[];
}[] = [
  {
    contract: {
      contract_id: 'RC-2026-031',
      supplier_id: 'S021',
      supplier_name: 'Pneumatic Point',
      start_date: new Date('2026-11-15T00:00:00.000Z'),
      end_date: new Date('2027-11-14T23:59:59.999Z'),
      value_cap: 2000000,
      consumed_value: 0,
    } as any,
    lines: [
      {
        contract_id: 'RC-2026-031',
        item_code: 'ITM-1036',
        description: 'Pneumatic cylinder 50x100',
        uom: 'NOS',
        rate: 3537.76,
      } as any,
      {
        contract_id: 'RC-2026-031',
        item_code: 'ITM-1037',
        description: 'Solenoid valve 5/2 1/4 inch',
        uom: 'NOS',
        rate: 2439.01,
      } as any,
      {
        contract_id: 'RC-2026-031',
        item_code: 'ITM-1039',
        description: 'FRL unit 1/2 inch',
        uom: 'NOS',
        rate: 2746.87,
      } as any,
    ],
  },
  {
    contract: {
      contract_id: 'RC-2026-033',
      supplier_id: 'S035',
      supplier_name: 'Infoline Systems',
      start_date: new Date('2026-11-20T00:00:00.000Z'),
      end_date: new Date('2027-11-19T23:59:59.999Z'),
      value_cap: 5000000,
      consumed_value: 0,
    } as any,
    lines: [
      {
        contract_id: 'RC-2026-033',
        item_code: 'ITM-1056',
        description: 'Laptop i5 16GB 512GB',
        uom: 'NOS',
        rate: 64654.36,
      } as any,
      {
        contract_id: 'RC-2026-033',
        item_code: 'ITM-1057',
        description: '24 inch monitor',
        uom: 'NOS',
        rate: 10689.51,
      } as any,
    ],
  },
];

/**
 * Merge DB contracts with any known PDF contracts not yet in DB
 */
export function getAllContractsWithPDFs(
  dbContracts: IContract[],
  dbLines: IContractLine[]
): { contracts: IContract[]; contractLines: IContractLine[] } {
  const existingContractIds = new Set(dbContracts.map((c) => c.contract_id));
  const contracts = [...dbContracts];
  const contractLines = [...dbLines];

  for (const pdf of PDF_CONTRACTS) {
    if (!existingContractIds.has(pdf.contract.contract_id)) {
      contracts.push(pdf.contract as IContract);
      contractLines.push(...(pdf.lines as IContractLine[]));
    }
  }

  return { contracts, contractLines };
}

/**
 * Contract State Tracker:
 * Keeps track of dynamic consumed values as requirements are evaluated in chronological order.
 */
export class ContractTracker {
  private consumedMap = new Map<string, number>();
  private contracts: IContract[];
  private contractLines: IContractLine[];
  private suppliersMap: Map<string, ISupplier>;

  constructor(
    contracts: IContract[],
    contractLines: IContractLine[],
    suppliers: ISupplier[]
  ) {
    const merged = getAllContractsWithPDFs(contracts, contractLines);
    this.contracts = merged.contracts;
    this.contractLines = merged.contractLines;
    this.suppliersMap = new Map(suppliers.map((s) => [s.supplier_id, s]));

    for (const c of this.contracts) {
      this.consumedMap.set(c.contract_id, c.consumed_value || 0);
    }
  }

  /**
   * Find applicable contract for an item as of requirementDate and quantity (Section 4.1 - 4.3).
   */
  public findContract(
    itemCode: string,
    quantity: number,
    requirementDate: Date
  ): ApplicableContractResult {
    const reqTime = requirementDate.getTime();

    // Find all lines covering this item
    const matchingLines = this.contractLines.filter(
      (cl) => cl.item_code === itemCode
    );

    if (matchingLines.length === 0) {
      return {
        contract: null,
        contractLine: null,
        rate: null,
        canBeUsed: false,
        lowestRateAmongAllApplicable: null,
      };
    }

    // 4.1: A contract applies if:
    // - covers item
    // - req date between start and end (inclusive)
    // - supplier is Active in supplier master
    interface Candidate {
      contract: IContract;
      line: IContractLine;
      currentConsumed: number;
      availableCeiling: number;
      requirementCost: number;
      hasCeiling: boolean;
    }

    const applicableCandidates: Candidate[] = [];

    for (const line of matchingLines) {
      const contract = this.contracts.find((c) => c.contract_id === line.contract_id);
      if (!contract) continue;

      // Check dates (inclusive)
      if (
        reqTime < contract.start_date.getTime() ||
        reqTime > contract.end_date.getTime()
      ) {
        continue;
      }

      // Check supplier status is Active
      const supplier = this.suppliersMap.get(contract.supplier_id);
      if (!supplier || supplier.status !== 'Active') {
        continue;
      }

      const currentConsumed = this.consumedMap.get(contract.contract_id) ?? 0;
      const availableCeiling = Math.max(0, contract.value_cap - currentConsumed);
      const requirementCost = quantity * line.rate;
      const hasCeiling = currentConsumed + requirementCost <= contract.value_cap;

      applicableCandidates.push({
        contract,
        line,
        currentConsumed,
        availableCeiling,
        requirementCost,
        hasCeiling,
      });
    }

    if (applicableCandidates.length === 0) {
      return {
        contract: null,
        contractLine: null,
        rate: null,
        canBeUsed: false,
        lowestRateAmongAllApplicable: null,
      };
    }

    // Sort by rate ASC (4.3: use the one with the lowest rate)
    applicableCandidates.sort((a, b) => a.line.rate - b.line.rate);

    const lowestRate = applicableCandidates[0].line.rate;

    // Filter candidates that still have enough ceiling (4.2 & 4.3)
    const validWithCeiling = applicableCandidates.filter((c) => c.hasCeiling);

    if (validWithCeiling.length > 0) {
      // Pick lowest rate that still has ceiling
      const best = validWithCeiling[0];
      return {
        contract: best.contract,
        contractLine: best.line,
        rate: best.line.rate,
        canBeUsed: true,
        lowestRateAmongAllApplicable: lowestRate,
      };
    }

    // All applicable contracts are out of ceiling
    return {
      contract: applicableCandidates[0].contract,
      contractLine: applicableCandidates[0].line,
      rate: applicableCandidates[0].line.rate,
      canBeUsed: false,
      lowestRateAmongAllApplicable: lowestRate,
      reason: 'Ceiling exhausted for all applicable contracts',
    };
  }

  /**
   * Consume ceiling when a requirement is committed to a CONTRACT_PO
   */
  public consumeCeiling(contractId: string, amount: number): void {
    const current = this.consumedMap.get(contractId) ?? 0;
    this.consumedMap.set(contractId, current + amount);
  }

  public getConsumed(contractId: string): number {
    return this.consumedMap.get(contractId) ?? 0;
  }
}
