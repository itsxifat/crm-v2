import mongoose from 'mongoose'

const VendorPaymentSchema = new mongoose.Schema(
  {
    vendorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    amount:      { type: Number, required: true },
    description: { type: String, default: null },
    date:        { type: Date, required: true },
    reference:   { type: String, default: null },
    status:      { type: String, default: 'pending' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.VendorPayment ?? mongoose.model('VendorPayment', VendorPaymentSchema)
