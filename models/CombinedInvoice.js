import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'

/**
 * CombinedInvoice — a consolidated invoice for a project that has more than one
 * child invoice.
 *
 * Only IDENTITY + presentation metadata is stored here. Every monetary figure
 * (subtotal, tax, discount, total, paid, due) and the child list are derived
 * from the live Invoice documents on each read by lib/combinedInvoice.js.
 *
 * That is deliberate: it makes "the combined invoice updates automatically when
 * a child invoice is edited, paid or cancelled" true by construction — there is
 * no duplicated total that can drift out of sync.
 */
const CombinedInvoiceSchema = new mongoose.Schema(
  {
    combinedNumber: { type: String, unique: true, sparse: true },

    // One combined invoice per project.
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    clientId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Client',  required: true },

    currency: { type: String, default: 'BDT' },

    notes: { type: String, default: null },
    terms: { type: String, default: null },

    // Presentation only — the real state is derived from the children.
    issuedAt:  { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// Numbering mirrors Invoice (ENV-YYMMA###) but uses a "C" series so a combined
// invoice is recognisable at a glance: ENV-2609C001.
CombinedInvoiceSchema.pre('validate', async function () {
  if (this.combinedNumber) return
  // Month boundaries follow the business timezone (Asia/Dhaka), not the server's.
  const parts  = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: '2-digit', month: '2-digit' })
    .formatToParts(new Date()).map(p => [p.type, p.value]))
  const yymm   = `${parts.year}${parts.month}`
  const prefix = `ENV-${yymm}C`
  // Highest number already issued for this prefix (NOT a count — a count reissues
  // an existing number after any delete and collides on the unique index).
  const existing = await mongoose.model('CombinedInvoice')
    .find({ combinedNumber: { $regex: `^${prefix}[0-9]+$` } })
    .select('combinedNumber').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(d.combinedNumber.slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`combinedInvoice:${prefix}`, maxUsed)
  this.combinedNumber = `${prefix}${String(seq).padStart(3, '0')}`
})

if (mongoose.models.CombinedInvoice) delete mongoose.models.CombinedInvoice
export default mongoose.model('CombinedInvoice', CombinedInvoiceSchema)
