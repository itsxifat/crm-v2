import mongoose from 'mongoose'

const ProjectDiscussionSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
    content:   { type: String, required: true, trim: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

ProjectDiscussionSchema.index({ projectId: 1, createdAt: 1 })

export default mongoose.models.ProjectDiscussion ?? mongoose.model('ProjectDiscussion', ProjectDiscussionSchema)
