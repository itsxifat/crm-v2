import mongoose from 'mongoose'

const ProjectVendorSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    vendorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    role:      { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

ProjectVendorSchema.index({ projectId: 1, vendorId: 1 }, { unique: true })

export default mongoose.models.ProjectVendor ?? mongoose.model('ProjectVendor', ProjectVendorSchema)
