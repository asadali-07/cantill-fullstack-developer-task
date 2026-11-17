import mongoose, { Schema, Document } from 'mongoose';

export interface IContract extends Document {
  contract_id: string;
  supplier_id: string;
  supplier_name: string;
  start_date: Date;
  end_date: Date;
  value_cap: number;
  consumed_value: number;
}

const contractSchema = new Schema<IContract>(
  {
    contract_id: { type: String, unique: true, required: true, trim: true },
    supplier_id: { type: String, required: true, ref: 'Supplier' },
    supplier_name: { type: String, required: true, trim: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    value_cap: { type: Number, required: true },
    consumed_value: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Contract = mongoose.model<IContract>('Contract', contractSchema);
