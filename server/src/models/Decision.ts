import mongoose, { Schema, Document } from 'mongoose';

export interface IPRLineRef {
  pr_no: string;
  pr_line: number;
}

export interface ISuggestedSupplier {
  supplier_id: string;
  name?: string;
  score?: number;
  rank?: number;
}

export interface IBuyerOverride {
  original_decision: string;
  new_decision: string;
  reason: string;
  overridden_by: string;
  overridden_at: Date;
}

export interface IDecision extends Document {
  decision_id: string;
  batch_id: string;
  policy_version: string;
  pr_lines: IPRLineRef[];
  item_code: string;
  item_description: string;
  plant: string;
  total_quantity: number;
  uom: string;
  unit_price: number;
  total_value: number;
  decision: string;
  decision_reason: string;
  contract_id?: string;
  suggested_suppliers: ISuggestedSupplier[];
  po_number?: string;
  consolidated_po_id?: string;
  status: string;
  buyer_override?: IBuyerOverride;
  created_at: Date;
}

const DECISION_TYPES = [
  'PO',
  'SOURCING_REQUEST',
  'CONTRACT_PO',
  'SPOT_PO',
  'EMERGENCY_PO',
  'RFQ',
  'RFP',
  'CAPEX_SOURCING',
  'NEW_ITEM_SOURCING',
  'DIRECT_PO',
  'INVALID_PR',
  'INVALID_PLANT',
];

const STATUS_TYPES = [
  'auto_approved',
  'pending_review',
  'buyer_approved',
  'buyer_overridden',
];

const decisionSchema = new Schema<IDecision>(
  {
    decision_id: { type: String, unique: true, required: true },
    batch_id: { type: String, required: true },
    policy_version: { type: String, required: true },
    pr_lines: [
      {
        pr_no: { type: String, required: true },
        pr_line: { type: Number, required: true },
        _id: false,
      },
    ],
    item_code: { type: String },
    item_description: { type: String },
    plant: { type: String },
    total_quantity: { type: Number },
    uom: { type: String },
    unit_price: { type: Number },
    total_value: { type: Number },
    decision: { type: String, required: true, enum: DECISION_TYPES },
    decision_reason: { type: String },
    contract_id: { type: String },
    suggested_suppliers: [
      {
        supplier_id: { type: String, required: true },
        name: { type: String },
        score: { type: Number },
        rank: { type: Number },
        _id: false,
      },
    ],
    po_number: { type: String },
    consolidated_po_id: { type: String },
    status: {
      type: String,
      enum: STATUS_TYPES,
      default: 'pending_review',
    },
    buyer_override: {
      type: Schema.Types.Mixed,
    },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

decisionSchema.index({ batch_id: 1 });
decisionSchema.index({ decision: 1 });
decisionSchema.index({ status: 1 });

export const Decision = mongoose.model<IDecision>('Decision', decisionSchema);
