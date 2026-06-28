import mongoose from 'mongoose'
const AuditLogSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userRole:  { type: String, default: null },   // encrypted
    action:    { type: String, required: true },  // encrypted
    entity:    { type: String, required: true },  // encrypted
    entityId:  { type: String, default: null },   // encrypted
    changes:   { type: String, default: null },   // encrypted
    ipAddress: { type: String, default: null },   // encrypted
    userAgent: { type: String, default: null },   // encrypted
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// TTL index — auto-delete after 356 days; keep time-based indexes plaintext
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30758400 })
AuditLogSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.models.AuditLog ?? mongoose.model('AuditLog', AuditLogSchema)
