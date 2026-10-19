import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'

// VAT treatment of a supply (Mushak-9.1 notes 1/3/4/7). 'NONE' = not a VAT
// invoice — the default, so every legacy document keeps its old behaviour.
const VAT_TREATMENT_ENUM = ['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE']

// Party snapshots taken when the invoice is issued (Mushak-6.3 needs the
// seller's and buyer's BIN exactly as they were on the tax point).
const InvoiceSellerSchema = new mongoose.Schema({
  name:    { type: String, default: null },
  bin:     { type: String, default: null },
  address: { type: String, default: null },
}, { _id: false })

const InvoiceBuyerSchema = new mongoose.Schema({
  name:    { type: String, default: null },
  bin:     { type: String, default: null },
  tin:     { type: String, default: null },
  address: { type: String, default: null },
}, { _id: false })

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

    // Mixed — encrypted JSON array (items contain financial data).
    // Each line: { description, quantity, rate, amount } plus (VAT invoices)
    // unit, serviceCode, vatRate, sdRate, discountShare, taxableValue,
    // sdAmount, vatAmount, lineTotal.
    items: { type: mongoose.Schema.Types.Mixed, default: [] },

    issueDate: { type: Date, default: Date.now },
    dueDate:   { type: Date, default: null },
    sentAt:    { type: Date, default: null },
    paidAt:    { type: Date, default: null },

    // Financial — Mixed (encrypted Number)
    subtotal:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    // taxRate/taxAmount = "MFS Charge" (mobile-payment surcharge). NOT VAT —
    // VAT and SD live in the dedicated fields below.
    taxRate:    { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxAmount:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    discount:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    total:      { type: mongoose.Schema.Types.Mixed, default: 0 },
    // Settled amount = cash received + VDS withheld + TDS withheld + credit
    // notes applied (breakdown in withheldVds / withheldTds / creditedAmount).
    paidAmount: { type: mongoose.Schema.Types.Mixed, default: 0 },
    currency:   { type: String, default: 'BDT' },
    totalBDT:   { type: Number, default: null }, // BDT-equivalent of total; == total for BDT

    // ── VAT (Mushak-6.3) ──
    vatTreatment:        { type: String, enum: VAT_TREATMENT_ENUM, default: 'NONE' },
    taxableValue:        { type: Number, default: null },  // value excl. VAT & SD (after discount)
    vatAmount:           { type: Number, default: 0 },
    sdAmount:            { type: Number, default: 0 },
    serviceCode:         { type: String, default: null },  // VAT service code, e.g. 'S099.10'
    deliveryDestination: { type: String, default: null },
    issuedAt:            { type: Date,   default: null },  // tax point (date + time of issue)
    seller:              { type: InvoiceSellerSchema, default: undefined },
    buyer:               { type: InvoiceBuyerSchema,  default: undefined },

    // ── Settlement breakdown (all included in paidAmount) ──
    withheldVds:    { type: Number, default: 0 },  // VAT deducted at source by the client
    withheldTds:    { type: Number, default: 0 },  // income tax deducted at source by the client
    creditedAmount: { type: Number, default: 0 },  // credit notes applied (Mushak-6.7)
    debitedAmount:  { type: Number, default: 0 },  // debit notes added to total (Mushak-6.8)

    outputVatEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxEntry', default: null },

    // Lease serialising credit/debit note work on one invoice (owner token +
    // claim time; app/api/credit-notes/_lib/creditNotes.js). No default and
    // never selected, so ordinary reads/saves can never see or clear a lease.
    noteLockId: { type: mongoose.Schema.Types.ObjectId, select: false },
    noteLockAt: { type: Date, select: false },

    notes:    { type: String, default: null },
    terms:    { type: String, default: null },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; delete ret.noteLockId; delete ret.noteLockAt; return ret },
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
