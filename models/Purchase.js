import mongoose from 'mongoose'

const PurchaseSchema = new mongoose.Schema(
  {
    vendorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    item:        { type: String, required: true, trim: true },
    description: { type: String, default: null },
    quantity:    { type: Number, default: 1, min: 0 },
    unitPrice:   { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    date:        { type: Date, required: true },
    category:    { type: String, default: null },
    status:      { type: String, default: 'pending', enum: ['pending', 'received', 'cancelled'] },
    invoiceRef:  { type: String, default: null },
    notes:       { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Purchase ?? mongoose.model('Purchase', PurchaseSchema)
