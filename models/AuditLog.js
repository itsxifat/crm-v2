import mongoose from 'mongoose'

const AuditLogSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userRole:  { type: String, default: null },
    action:    { type: String, required: true },   // LOGIN, CREATE, UPDATE, DELETE, etc.
    entity:    { type: String, required: true },   // USER, PROJECT, INVOICE, etc.
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

// TTL: auto-delete after 356 days
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30758400 })
// Efficient per-user queries sorted by time
AuditLogSchema.index({ userId: 1, createdAt: -1 })
// Filter by action type
AuditLogSchema.index({ action: 1, createdAt: -1 })
// Filter by role
AuditLogSchema.index({ userRole: 1, createdAt: -1 })

export default mongoose.models.AuditLog ?? mongoose.model('AuditLog', AuditLogSchema)
