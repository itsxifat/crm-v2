import mongoose from 'mongoose'

/**
 * A prepared / filed tax return. One document per (kind, periodKey):
 *   VAT_RETURN        periodKey 'YYYY-MM' or 'YYYY-MM..YYYY-MM' (quarterly)
 *   WHT_RETURN        periodKey '2026-27-Q1'
 *   ADVANCE_TAX       periodKey '2026-27-1'..'-4' (instalment)
 *   INCOME_TAX_RETURN periodKey '2026-27' (income year)
 * `snapshot` freezes the computed return (e.g. computeVatReturn output) at filing.
 */
const ChallanSchema = new mongoose.Schema(
  {
    challanNo:   { type: String, default: null, trim: true },
    date:        { type: Date, default: null },
    bank:        { type: String, default: null, trim: true },
    branch:      { type: String, default: null, trim: true },
    accountCode: { type: String, default: null, trim: true },
    amount:      { type: Number, default: 0, min: 0 },
    // VAT challan ⇒ Mushak-9.1 note 58; SD challan ⇒ note 59. Older rows have no head (VAT).
    head:        { type: String, enum: ['VAT', 'SD'], default: 'VAT' },
  },
  { _id: false }
)

const TaxFilingSchema = new mongoose.Schema(
  {
    kind:        { type: String, enum: ['VAT_RETURN', 'WHT_RETURN', 'ADVANCE_TAX', 'INCOME_TAX_RETURN'], required: true },
    periodKey:   { type: String, required: true, trim: true },
    periodStart: { type: String, default: null },   // 'YYYY-MM'
    periodEnd:   { type: String, default: null },   // 'YYYY-MM'
    fiscalYear:  { type: String, default: null },

    status:     { type: String, enum: ['DRAFT', 'FILED', 'AMENDED'], default: 'DRAFT' },
    returnType: { type: String, enum: ['ORIGINAL', 'LATE', 'AMENDED', 'FULL_ADDITIONAL'], default: 'ORIGINAL' },

    snapshot:        { type: mongoose.Schema.Types.Mixed, default: null },
    netPayable:      { type: Number, default: 0 },
    closingBalance:  { type: Number, default: 0 },
    refundRequested: { type: Number, default: 0 },
    challans:        { type: [ChallanSchema], default: [] },

    filedAt:           { type: Date, default: null },
    filedBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgementNo: { type: String, default: null, trim: true },
    attachmentUrl:     { type: String, default: null },
    notes:             { type: String, default: null },
    createdBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

TaxFilingSchema.index({ kind: 1, periodKey: 1 }, { unique: true })
TaxFilingSchema.index({ kind: 1, periodEnd: -1, status: 1 })

if (mongoose.models.TaxFiling) delete mongoose.models.TaxFiling
export default mongoose.model('TaxFiling', TaxFilingSchema)
