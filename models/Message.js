import mongoose from 'mongoose'

const MessageSchema = new mongoose.Schema(
  {
    content:    { type: String, required: true },
    senderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isRead:     { type: Boolean, default: false },
    roomId:     { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Message ?? mongoose.model('Message', MessageSchema)
