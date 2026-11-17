import mongoose, { Schema, Document } from 'mongoose';

export interface IItem extends Document {
  item_code: string;
  description: string;
  uom: string;
  category: string;
  item_type: 'Material' | 'Service' | 'Capex';
  standard_price: number;
}

const UOM_VALUES = [
  'NOS', 'KG', 'MTR', 'LTR', 'CYL', 'BRL', 'BKT',
  'SET', 'PAIR', 'ROL', 'REAM', 'MON', 'QTR', 'JOB',
];

const CATEGORY_VALUES = [
  'Steel & Metals',
  'Fasteners',
  'Welding Consumables',
  'Bearings & Transmission',
  'Electrical Spares',
  'Hydraulics & Pneumatics',
  'Packaging',
  'Safety & PPE',
  'Lubricants',
  'Office & IT',
  'Facility Services',
  'Testing & Calibration',
  'Capital Equipment',
];

const itemSchema = new Schema<IItem>(
  {
    item_code: { type: String, unique: true, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    uom: { type: String, required: true, enum: UOM_VALUES },
    category: { type: String, required: true, enum: CATEGORY_VALUES },
    item_type: { type: String, required: true, enum: ['Material', 'Service', 'Capex'] },
    standard_price: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Item = mongoose.model<IItem>('Item', itemSchema);
