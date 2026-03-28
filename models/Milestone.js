import mongoose from 'mongoose'

const MilestoneSchema = new mongoose.Schema(
  {
    projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: null },
    dueDate:     { type: Date, default: null },
    completed:   { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Milestone ?? mongoose.model('Milestone', MilestoneSchema)
