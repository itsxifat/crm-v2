import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const TransactionSchema = new mongoose.Schema(
  {
    txnId:    { type: String, unique: true, sparse: true, default: null },
    type:     { type: String, enum: ['INCOME', 'EXPENSE'], required: true },

    // Content — all encrypted
    category:    { type: String, required: true },
    amount:      { type: mongoose.Schema.Types.Mixed, required: true }, // encrypted Number
    currency:    { type: String, default: 'BDT' },
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

    paymentMethod: {
      type: String,
      enum: ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER'],
      default: null,
    },
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
  const today    = new Date()
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix   = `TXN-${datePart}-`
  const count    = await mongoose.model('Transaction').countDocuments({ txnId: { $regex: `^${prefix}` } })
  this.txnId = `${prefix}${String(count + 1).padStart(4, '0')}`
})

TransactionSchema.plugin(encryptionPlugin, {
  collection: 'transactions',
  fields: [
    { path: 'category'    },
    { path: 'amount',     type: 'number' },
    { path: 'currency'    },
    { path: 'description' },
    { path: 'reference'   },
    { path: 'paidToName'  },
    { path: 'vendor'      },
    { path: 'receiptUrl'  },
  ],
})

if (mongoose.models.Transaction) delete mongoose.models.Transaction
export default mongoose.model('Transaction', TransactionSchema)
