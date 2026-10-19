import mongoose from 'mongoose'
const VendorSchema = new mongoose.Schema(
  {
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // All business/contact fields stored encrypted
    company:     { type: String, required: true, trim: true },
    contactName: { type: String, default: null },
    email:       { type: String, default: null },
    phone:       { type: String, default: null },
    serviceType: { type: String, default: null },
    address:     { type: String, default: null },
    website:     { type: String, default: null },
    notes:       { type: String, default: null },

    // ── Tax identity (Bangladesh) ──
    bin:                   { type: String, default: null },   // VAT BIN (9 or 13 digits)
    tin:                   { type: String, default: null },   // e-TIN (12 digits)
    tradeLicense:          { type: String, default: null },
    vatRegistrationType:   { type: String, enum: ['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN', null], default: null },
    payeeType:             { type: String, enum: ['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT'], default: 'COMPANY' },
    hasPsr:                { type: Boolean, default: false },  // Proof of Submission of Return (s.264) — no PSR ⇒ TDS +50%
    defaultTdsSection:     { type: String, default: null },
    defaultVatServiceCode: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// Re-register on hot reload so schema additions (tax identity) take effect —
// a cached model would silently drop the new fields under strict mode.
if (mongoose.models.Vendor) delete mongoose.models.Vendor
export default mongoose.model('Vendor', VendorSchema)
