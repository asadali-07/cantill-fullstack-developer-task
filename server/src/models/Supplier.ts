import mongoose, { Schema, Document } from 'mongoose';

export interface ISupplier extends Document {
  supplier_id: string;
  name: string;
  city: string;
  categories: string[];
  status: 'Active' | 'Blocked' | 'Inactive';
  on_time_pct: number;
  quality_rating: number;
}

const supplierSchema = new Schema<ISupplier>(
  {
    supplier_id: { type: String, unique: true, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    categories: { type: [String], required: true },
    status: { type: String, required: true, enum: ['Active', 'Blocked', 'Inactive'] },
    on_time_pct: { type: Number, required: true },
    quality_rating: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Supplier = mongoose.model<ISupplier>('Supplier', supplierSchema);
