import mongoose from 'mongoose'

const VendorSchema = new mongoose.Schema(
  {
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    company:     { type: String, required: true, trim: true },
    contactName: { type: String, default: null },
    email:       { type: String, default: null },
    phone:       { type: String, default: null },
    serviceType: { type: String, default: null },
    address:     { type: String, default: null },
    website:     { type: String, default: null },
    notes:       { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Vendor ?? mongoose.model('Vendor', VendorSchema)
