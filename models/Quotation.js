import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'
const QuotationSchema = new mongoose.Schema(
  {
    quotationNumber: { type: String, unique: true, sparse: true },

    sourceType: { type: String, enum: ['LEAD', 'CLIENT'], required: true },
    leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead',   default: null },
    clientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },

    // Recipient snapshot — all encrypted
    recipientName:    { type: String, default: null },
    recipientCompany: { type: String, default: null },
    recipientEmail:   { type: String, default: null },
    recipientPhone:   { type: String, default: null },
    recipientAddress: { type: String, default: null },

    status: {
      type:    String,
      enum:    ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'],
      default: 'DRAFT',
    },

    // Mixed — encrypted JSON array
    items: { type: mongoose.Schema.Types.Mixed, default: [] },

    issueDate:  { type: Date, default: Date.now },
    validUntil: { type: Date, default: null },
    sentAt:     { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },

    // Financial — Mixed (encrypted Number)
    subtotal:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    // taxRate/taxAmount = "MFS Charge" (mobile-payment surcharge), not VAT.
    taxRate:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxAmount: { type: mongoose.Schema.Types.Mixed, default: 0 },
    discount:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    total:     { type: mongoose.Schema.Types.Mixed, default: 0 },
    currency:  { type: String, default: 'BDT' },
    totalBDT:  { type: Number, default: null }, // BDT-equivalent of total; == total for BDT

    // ── VAT (mirrors Invoice; 'NONE' keeps legacy quotations unchanged) ──
    vatTreatment: { type: String, enum: ['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE'], default: 'NONE' },
    taxableValue: { type: Number, default: null },
    vatAmount:    { type: Number, default: 0 },
    sdAmount:     { type: Number, default: 0 },
    serviceCode:  { type: String, default: null },

    notes:         { type: String,  default: null },
    terms:         { type: String,  default: null },
    itemPriceOnly: { type: Boolean, default: false },

    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User',      default: null },
    duplicatedFromId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

QuotationSchema.pre('save', async function (next) {
  if (this.quotationNumber) return next()
  try {
    // Highest number already issued is only a floor for the atomic counter, so
    // concurrent creates never get the same number and a deleted quotation's
    // number is never reissued. QT00001; numbers issued before 2026-10 read
    // QT-00001 and count too (the counter key has no prefix, so it carries on).
    const re = /^QT-?(\d+)$/
    const existing = await mongoose.model('Quotation')
      .find({ quotationNumber: { $regex: re.source } }, { quotationNumber: 1 })
      .lean()
    const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(re.exec(d.quotationNumber)?.[1], 10) || 0), 0)
    const nextNum = await nextSequence('quotation', maxUsed)
    this.quotationNumber = `QT${String(nextNum).padStart(5, '0')}`
    next()
  } catch (err) {
    next(err)
  }
})

if (mongoose.models.Quotation) delete mongoose.models.Quotation
export default mongoose.model('Quotation', QuotationSchema)
