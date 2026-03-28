import mongoose from 'mongoose'

const DocumentSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    description:  { type: String, default: null },
    fileUrl:      { type: String, required: true },
    fileSize:     { type: Number, default: null },
    mimeType:     { type: String, default: null },
    category:     { type: String, default: null },
    projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    clientId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', default: null },
    vendorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
    version:      { type: Number, default: 1 },
    uploadedBy:   { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Document ?? mongoose.model('Document', DocumentSchema)
