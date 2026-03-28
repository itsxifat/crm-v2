import mongoose from 'mongoose'

const TransactionSchema = new mongoose.Schema(
  {
    // CRM-generated serial tracking ID (e.g. TXN-20240315-0001)
    // Required if no receiptUrl — enforced at API level
    txnId:         { type: String, unique: true, sparse: true, default: null },

    type:          { type: String, enum: ['INCOME', 'EXPENSE'], required: true },
    category:      { type: String, required: true },
    amount:        { type: Number, required: true },
    currency:      { type: String, default: 'BDT' },  // BDT only
    description:   { type: String, required: true },
    date:          { type: Date,   required: true },
    reference:     { type: String, default: null },

    // Relations
    projectId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    clientId:      { type: String, default: null },
    vendorId:      { type: String, default: null },
    freelancerId:  { type: String, default: null },

    // People
    vendor:         { type: String, default: null },          // vendor name (free text)
    paidBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    accountManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Payment details
    paymentMethod: {
      type: String,
      enum: ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER'],
      default: null,
    },
    receiptUrl:    { type: String, default: null },
  },
  {
    timestamps: true,   // createdAt = exact entry timestamp
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// Auto-generate txnId before first save if not provided
TransactionSchema.pre('save', async function () {
  if (this.txnId) return
  const today    = new Date()
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix   = `TXN-${datePart}-`
  const count    = await mongoose.model('Transaction').countDocuments({
    txnId: { $regex: `^${prefix}` },
  })
  this.txnId = `${prefix}${String(count + 1).padStart(4, '0')}`
})

if (mongoose.models.Transaction) delete mongoose.models.Transaction
export default mongoose.model('Transaction', TransactionSchema)
