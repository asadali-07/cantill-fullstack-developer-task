import { IPolicyRules } from '../models/PolicyVersion';

export interface DefaultPolicyData {
  version: string;
  effective_date: Date;
  is_active: boolean;
  description: string;
  rules: IPolicyRules;
  amendments: never[];
}

export const defaultPolicy: DefaultPolicyData = {
  version: '5.0',
  effective_date: new Date('2026-01-01'),
  is_active: true,
  description: 'Corvo Procurement Policy v5.0',
  rules: {
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
  amendments: [],
};
