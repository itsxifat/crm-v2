import mongoose from 'mongoose'

const ProjectRenewalSchema = new mongoose.Schema(
  {
    projectId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    periodStart:     { type: Date, required: true },
    periodEnd:       { type: Date, required: true },
    billingAmount:   { type: Number, required: true },
    discountApplied: { type: Number, default: 0 },
    status:          { type: String, enum: ['PENDING','INVOICED','PAID','CANCELLED'], default: 'PENDING' },
    invoiceId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    renewedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes:           { type: String, default: null },
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

export default mongoose.models.ProjectRenewal ?? mongoose.model('ProjectRenewal', ProjectRenewalSchema)
