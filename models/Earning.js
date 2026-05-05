import mongoose from 'mongoose'

const EarningSchema = new mongoose.Schema(
  {
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', required: true },
    projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    amount:       { type: Number, required: true },
    type:         { type: String, required: true },
    description:  { type: String, required: true },
    approvedBy:   { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Earning ?? mongoose.model('Earning', EarningSchema)
