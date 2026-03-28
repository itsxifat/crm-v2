import mongoose from 'mongoose'

const AgreementSchema = new mongoose.Schema(
  {
    title:        { type: String, required: true, trim: true },
    type:         { type: String, required: true },
    content:      { type: String, default: null },
    fileUrl:      { type: String, default: null },
    status:       {
      type:    String,
      enum:    ['DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'CANCELLED'],
      default: 'DRAFT',
    },
    expiryDate:   { type: Date, default: null },
    signedAt:     { type: Date, default: null },
    signatureUrl: { type: String, default: null },
    version:      { type: Number, default: 1 },
    clientId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', default: null },
    vendorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
    projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    createdBy:    { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Agreement ?? mongoose.model('Agreement', AgreementSchema)
