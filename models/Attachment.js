import mongoose from 'mongoose'

const AttachmentSchema = new mongoose.Schema(
  {
    fileUrl:  { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, default: null },
    mimeType: { type: String, default: null },
    leadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    taskId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Attachment ?? mongoose.model('Attachment', AttachmentSchema)
