import mongoose from 'mongoose'

/**
 * A client-initiated password reset request. Clients cannot self-reset — they
 * submit a request that lands in a super-admin queue; an authorised staff member
 * approves it, which emails the client a one-time reset link.
 */
const PasswordResetRequestSchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
    clientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    email:      { type: String, required: true },
    status:     { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'], default: 'PENDING' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date,   default: null },
    note:       { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

PasswordResetRequestSchema.index({ status: 1, createdAt: -1 })
PasswordResetRequestSchema.index({ userId: 1, status: 1 })

export default mongoose.models.PasswordResetRequest
  ?? mongoose.model('PasswordResetRequest', PasswordResetRequestSchema)
