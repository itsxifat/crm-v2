import mongoose from 'mongoose'

/**
 * Effective-dated tax rate master data.
 *   kind VAT_SERVICE — VAT service code (rate charged + VDS rate).
 *   kind TDS_SECTION — income-tax withholding section (rates per payee type).
 * System rows are seeded from lib/tax/catalog.js (isSystem: true); they can be
 * edited or deactivated but never deleted. A rate change is a NEW row with a
 * later effectiveFrom (the latest version effective on a date wins).
 * effectiveFrom / effectiveTo are Dhaka-midnight instants of inclusive days.
 */
const TaxCodeSchema = new mongoose.Schema(
  {
    kind:        { type: String, enum: ['VAT_SERVICE', 'TDS_SECTION'], required: true },
    code:        { type: String, required: true, trim: true, uppercase: true },
    label:       { type: String, required: true, trim: true },
    description: { type: String, default: null },

    // VAT_SERVICE
    vatRate:   { type: Number, default: null, min: 0, max: 100 },
    vdsRate:   { type: Number, default: null, min: 0, max: 100 },
    treatment: { type: String, enum: ['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE', null], default: null },

    // TDS_SECTION
    section:        { type: String, default: null, trim: true },
    rateCompany:    { type: Number, default: null, min: 0, max: 100 },
    rateIndividual: { type: Number, default: null, min: 0, max: 100 },
    basis:          { type: String, enum: ['GROSS', 'COMMISSION_OR_GROSS'], default: 'GROSS' },
    commissionRate: { type: Number, default: null, min: 0, max: 100 },
    grossRate:      { type: Number, default: null, min: 0, max: 100 },

    effectiveFrom: { type: Date, required: true },
    effectiveTo:   { type: Date, default: null },
    isActive:      { type: Boolean, default: true },
    isSystem:      { type: Boolean, default: false },
    sortOrder:     { type: Number, default: 0 },
    notes:         { type: String, default: null },   // source / legal reference
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

TaxCodeSchema.index({ kind: 1, code: 1, effectiveFrom: 1 }, { unique: true })
TaxCodeSchema.index({ kind: 1, isActive: 1, sortOrder: 1 })

if (mongoose.models.TaxCode) delete mongoose.models.TaxCode
export default mongoose.model('TaxCode', TaxCodeSchema)
