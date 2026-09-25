import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'
const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, unique: true, sparse: true },

    clientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client',  required: true },
    projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    projectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],

    status: {
      type:    String,
      enum:    ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
      default: 'DRAFT',
    },

    // Mixed — encrypted JSON array (items contain financial data)
    items: { type: mongoose.Schema.Types.Mixed, default: [] },

    issueDate: { type: Date, default: Date.now },
    dueDate:   { type: Date, default: null },
    sentAt:    { type: Date, default: null },
    paidAt:    { type: Date, default: null },

    // Financial — Mixed (encrypted Number)
    subtotal:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxRate:    { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxAmount:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    discount:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    total:      { type: mongoose.Schema.Types.Mixed, default: 0 },
    paidAmount: { type: mongoose.Schema.Types.Mixed, default: 0 },
    currency:   { type: String, default: 'BDT' },
    totalBDT:   { type: Number, default: null }, // BDT-equivalent of total; == total for BDT

    notes:    { type: String, default: null },
    terms:    { type: String, default: null },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

InvoiceSchema.pre('validate', async function () {
  if (this.invoiceNumber) return
  // Month boundaries follow the business timezone (Asia/Dhaka), not the server's.
  const parts  = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: '2-digit', month: '2-digit' })
    .formatToParts(new Date()).map(p => [p.type, p.value]))
  const yymm   = `${parts.year}${parts.month}`
  const prefix = `ENV-${yymm}A`
  // Highest number already issued for this prefix (NOT a count — a count reissues
  // an existing number after any delete and collides on the unique index).
  const existing = await mongoose.model('Invoice')
    .find({ invoiceNumber: { $regex: `^${prefix}[0-9]+$` } })
    .select('invoiceNumber').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(d.invoiceNumber.slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`invoice:${prefix}`, maxUsed)
  this.invoiceNumber = `${prefix}${String(seq).padStart(3, '0')}`
})

// A project may carry MANY invoices (phases, retainers, change requests). They
// are rolled up by CombinedInvoice, so this index is plain — NOT unique.
// (The old unique index is dropped by scripts/migrate-combined-invoices.js.)
InvoiceSchema.index({ projectId: 1 })
InvoiceSchema.index({ clientId: 1, status: 1 })

if (mongoose.models.Invoice) delete mongoose.models.Invoice
export default mongoose.model('Invoice', InvoiceSchema)
