import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'
const TransactionSchema = new mongoose.Schema(
  {
    txnId:    { type: String, unique: true, sparse: true, default: null },
    type:     { type: String, enum: ['INCOME', 'EXPENSE'], required: true },

    // Content — all encrypted
    category:    { type: String, required: true },
    amount:      { type: mongoose.Schema.Types.Mixed, required: true }, // amount in `currency`
    currency:    { type: String, default: 'BDT' },
    amountBDT:   { type: Number, default: null }, // BDT-equivalent actually spent/received; == amount for BDT
    description: { type: String, required: true },
    reference:   { type: String, default: null },

    projectId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Project',    default: null },
    invoiceId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice',     default: null },
    agencyId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer',  default: null },
    paidToEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee',    default: null },
    paidToName:       { type: String, default: null }, // encrypted
    clientId:         { type: String, default: null },
    vendorId:         { type: String, default: null },
    freelancerId:     { type: String, default: null },
    vendor:           { type: String, default: null }, // encrypted

    paidBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    accountManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    paymentMethod:   { type: String, default: null },
    expenseCategory: { type: String, default: null }, // encrypted — sub-category for EXPENSE
    receiptUrl: { type: String, default: null }, // encrypted
    date:       { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

TransactionSchema.pre('save', async function () {
  if (this.txnId) return
  // Calendar day in the business timezone (Asia/Dhaka, UTC+6, no DST).
  const dhakaNow = new Date(Date.now() + 6 * 60 * 60 * 1000)
  const datePart = dhakaNow.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix   = `TXN-${datePart}-`
  // Highest sequence already issued today (NOT a count — a count reissues an
  // existing id once any of today's ids is renamed/removed and collides on the
  // unique index). The atomic counter keeps concurrent saves from colliding.
  const existing = await mongoose.model('Transaction')
    .find({ txnId: { $regex: `^${prefix}[0-9]+$` } })
    .select('txnId').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(d.txnId.slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`txn:${prefix}`, maxUsed)
  this.txnId = `${prefix}${String(seq).padStart(4, '0')}`
})

if (mongoose.models.Transaction) delete mongoose.models.Transaction
export default mongoose.model('Transaction', TransactionSchema)
