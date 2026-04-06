import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

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
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

VendorSchema.plugin(encryptionPlugin, {
  collection: 'vendors',
  fields: [
    { path: 'company'     },
    { path: 'contactName' },
    { path: 'email'       },
    { path: 'phone'       },
    { path: 'serviceType' },
    { path: 'address'     },
    { path: 'website'     },
    { path: 'notes'       },
  ],
})

export default mongoose.models.Vendor ?? mongoose.model('Vendor', VendorSchema)
