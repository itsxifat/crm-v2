import mongoose from 'mongoose'

const PaymentSchema = new mongoose.Schema(
  {
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amount:    { type: Number, required: true },
    method:    { type: String, required: true },
    reference: { type: String, default: null },
    status:    {
      type:    String,
      enum:    ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
    },
    paidAt:    { type: Date, default: null },
    notes:     { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Payment ?? mongoose.model('Payment', PaymentSchema)
