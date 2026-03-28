import mongoose from 'mongoose'

const PricingCategorySchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    description:  { type: String, default: null },
    unit:         { type: String, default: null },
    defaultPrice: { type: Number, default: null },
    isActive:     { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

if (mongoose.models.PricingCategory) delete mongoose.models.PricingCategory
export default mongoose.model('PricingCategory', PricingCategorySchema)
