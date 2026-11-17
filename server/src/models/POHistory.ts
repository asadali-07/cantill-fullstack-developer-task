import mongoose, { Schema, Document } from 'mongoose';

export interface IPOHistory extends Document {
  po_number: string;
  po_date: Date;
  supplier_id: string;
  item_code: string;
  quantity: number;
  uom: string;
  unit_price: number;
  plant: string;
  delivered_on_time: boolean;
}

const poHistorySchema = new Schema<IPOHistory>(
  {
    po_number: { type: String, required: true },
    po_date: { type: Date, required: true },
    supplier_id: { type: String, required: true },
    item_code: { type: String, required: true },
    quantity: { type: Number, required: true },
    uom: { type: String, required: true },
    unit_price: { type: Number, required: true },
    plant: { type: String, required: true },
    delivered_on_time: { type: Boolean, required: true },
  },
  { timestamps: true }
);

poHistorySchema.index({ supplier_id: 1 });
poHistorySchema.index({ item_code: 1 });
poHistorySchema.index({ po_date: -1 });

export const POHistory = mongoose.model<IPOHistory>('POHistory', poHistorySchema);
