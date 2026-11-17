import mongoose, { Schema, Document } from 'mongoose';

export interface IPreferredSupplierWeights {
  order_recency: number;
  order_frequency: number;
  contract_history: number;
  on_time_delivery: number;
  quality_score: number;
}

export interface IPolicyRules {
  clubbing_window_days: number;
  clubbing_needby_tolerance_days: number;
  spot_po_limit: number;
  emergency_po_limit: number;
  rfq_limit: number;
  rfp_threshold: number;
  rfq_vendor_count: number;
  rfp_vendor_count: number;
  capex_vendor_count: number;
  valuation_lookback_days: number;
  po_consolidation_window_hours: number;
  preferred_supplier_weights: IPreferredSupplierWeights;
}

export interface IPolicyAmendment {
  amendment_id: string;
  applied_at: Date;
  description: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface IPolicyVersion extends Document {
  version: string;
  effective_date: Date;
  is_active: boolean;
  created_at: Date;
  description: string;
  rules: IPolicyRules;
  amendments: IPolicyAmendment[];
}

const policyVersionSchema = new Schema<IPolicyVersion>(
  {
    version: { type: String, required: true, unique: true, trim: true },
    effective_date: { type: Date, required: true },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    description: { type: String, trim: true },
    rules: {
      type: Schema.Types.Mixed,
      required: true,
      default: {
        clubbing_window_days: 14,
        clubbing_needby_tolerance_days: 7,
        spot_po_limit: 200000,
        emergency_po_limit: 500000,
        rfq_limit: 1000000,
        rfp_threshold: 1000000,
        rfq_vendor_count: 3,
        rfp_vendor_count: 5,
        capex_vendor_count: 5,
        valuation_lookback_days: 365,
        po_consolidation_window_hours: 24,
        preferred_supplier_weights: {
          order_recency: 0.25,
          order_frequency: 0.20,
          contract_history: 0.20,
          on_time_delivery: 0.20,
          quality_score: 0.15,
        },
      },
    },
    amendments: {
      type: Schema.Types.Mixed,
      default: [],
    },
  },
  { timestamps: true }
);

export const PolicyVersion = mongoose.model<IPolicyVersion>('PolicyVersion', policyVersionSchema);
