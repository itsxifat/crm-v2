import mongoose from 'mongoose'

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
  const now    = new Date()
  const yymm   = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `ENV-${yymm}C`
  const count  = await mongoose.model('CombinedInvoice').countDocuments({ combinedNumber: { $regex: `^${prefix}` } })
  this.combinedNumber = `${prefix}${String(count + 1).padStart(3, '0')}`
})

if (mongoose.models.CombinedInvoice) delete mongoose.models.CombinedInvoice
export default mongoose.model('CombinedInvoice', CombinedInvoiceSchema)
