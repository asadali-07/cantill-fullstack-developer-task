import mongoose, { Schema, Document } from 'mongoose';

export interface IContractLine extends Document {
  contract_id: string;
  item_code: string;
  description: string;
  uom: string;
  rate: number;
}

const contractLineSchema = new Schema<IContractLine>(
  {
    contract_id: { type: String, required: true, ref: 'Contract' },
    item_code: { type: String, required: true },
    description: { type: String, required: true, trim: true },
    uom: { type: String, required: true },
    rate: { type: Number, required: true },
  },
  { timestamps: true }
);

contractLineSchema.index({ contract_id: 1, item_code: 1 });

export const ContractLine = mongoose.model<IContractLine>('ContractLine', contractLineSchema);
