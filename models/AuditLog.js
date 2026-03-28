import mongoose from 'mongoose'

const AuditLogSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action:    { type: String, required: true },
    entity:    { type: String, required: true },
    entityId:  { type: String, default: null },
    changes:   { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.AuditLog ?? mongoose.model('AuditLog', AuditLogSchema)
