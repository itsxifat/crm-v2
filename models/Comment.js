import mongoose from 'mongoose'

const CommentSchema = new mongoose.Schema(
  {
    content:    { type: String, required: true },
    taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    authorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isInternal: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Comment ?? mongoose.model('Comment', CommentSchema)
