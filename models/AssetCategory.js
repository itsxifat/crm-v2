import mongoose from 'mongoose'
import { TAX_DEPRECIATION_CLASSES } from '../lib/tax/catalog'
import { CATEGORY_TYPES, DEPRECIATION_METHODS, CATEGORY_CODE_REGEX } from '../lib/inventory/constants'

const FALLBACK_LIFE_MONTHS = 60

const AssetCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: {
      type: String, required: true, unique: true, uppercase: true, trim: true,
      match: [CATEGORY_CODE_REGEX, 'Code must be 2–6 letters or digits (A–Z, 0–9)'],
    },
    type:               { type: String, enum: CATEGORY_TYPES, default: 'ASSET' },
    taxClass:           { type: String, default: 'OTHER' },          // TAX_DEPRECIATION_CLASSES key
    depreciationMethod: { type: String, enum: DEPRECIATION_METHODS, default: 'STRAIGHT_LINE' },
    usefulLifeMonths:   { type: Number, min: 1, max: 1200 },          // default from the tax class's bookLifeMonths
    residualPct:        { type: Number, default: 0, min: 0, max: 100 },
    decliningRatePct:   { type: Number, default: null, min: 0, max: 100 },
    capitalize:              { type: Boolean, default: true },
    requiresAcknowledgement: { type: Boolean, default: true },
    inputVatCreditable:      { type: Boolean, default: false },
    description: { type: String, default: null },
    isActive:    { type: Boolean, default: true },
    sortOrder:   { type: Number, default: 0 },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

AssetCategorySchema.pre('validate', function () {
  if (typeof this.code === 'string') this.code = this.code.toUpperCase().replace(/\s+/g, '')
  if (!this.taxClass) this.taxClass = 'OTHER'
  const cls = TAX_DEPRECIATION_CLASSES?.[this.taxClass] ?? null
  if (this.usefulLifeMonths == null || !(Number(this.usefulLifeMonths) > 0)) {
    this.usefulLifeMonths = Number(cls?.bookLifeMonths) > 0 ? Number(cls.bookLifeMonths) : FALLBACK_LIFE_MONTHS
  }
})

AssetCategorySchema.index({ isActive: 1, sortOrder: 1, name: 1 })
AssetCategorySchema.index({ type: 1 })

if (mongoose.models.AssetCategory) delete mongoose.models.AssetCategory
export default mongoose.model('AssetCategory', AssetCategorySchema)
