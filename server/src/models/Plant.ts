import mongoose, { Schema, Document } from 'mongoose';

export interface IPlant extends Document {
  plant: string;
  name: string;
}

const plantSchema = new Schema<IPlant>(
  {
    plant: { type: String, unique: true, required: true, trim: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

export const Plant = mongoose.model<IPlant>('Plant', plantSchema);
