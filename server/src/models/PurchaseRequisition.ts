import mongoose, { Schema, Document } from 'mongoose';

export interface IPurchaseRequisition extends Document {
  pr_no: string;
  pr_line: number;
  created_at: Date;
  requester: string;
  department: string;
  plant: string;
  item_code: string;
  description: string;
  quantity: number;
  uom: string;
  estimated_unit_price?: number;
  need_by_date: Date;
  urgency: 'Normal' | 'Emergency';
  source: 'csv_batch' | 'chat';
  status: 'pending' | 'processed' | 'overridden';
  batch_id?: string;
}

const purchaseRequisitionSchema = new Schema<IPurchaseRequisition>(
  {
    pr_no: { type: String, required: true },
    pr_line: { type: Number, required: true },
    created_at: { type: Date, required: true },
    requester: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    plant: { type: String, required: true },
    item_code: { type: String, default: '' },
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true },
    uom: { type: String, required: true },
    estimated_unit_price: { type: Number },
    need_by_date: { type: Date, required: true },
    urgency: { type: String, enum: ['Normal', 'Emergency'], default: 'Normal' },
    source: { type: String, enum: ['csv_batch', 'chat'], default: 'csv_batch' },
    status: { type: String, enum: ['pending', 'processed', 'overridden'], default: 'pending' },
    batch_id: { type: String },
  },
  { timestamps: true }
);

purchaseRequisitionSchema.index({ pr_no: 1, pr_line: 1 });
purchaseRequisitionSchema.index({ batch_id: 1 });
purchaseRequisitionSchema.index({ status: 1 });

export const PurchaseRequisition = mongoose.model<IPurchaseRequisition>(
  'PurchaseRequisition',
  purchaseRequisitionSchema
);
