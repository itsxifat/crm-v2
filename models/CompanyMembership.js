import mongoose from 'mongoose'

/**
 * CompanyMembership — the many-to-many join between a person (User) and a
 * company account (Client). Access to a company's client panel is governed by
 * an ACTIVE membership here, NOT by the legacy single Client.userId FK.
 *
 *   one person  → many companies  (many memberships sharing userId)
 *   many people → one company     (many memberships sharing clientId)
 *
 * `role` is informational only — every ACTIVE member has full access.
 */
const CompanyMembershipSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    role:     { type: String, enum: ['OWNER', 'MEMBER'],   default: 'MEMBER' },
    status:   { type: String, enum: ['ACTIVE', 'REMOVED'], default: 'ACTIVE' },
    addedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// One membership row per (person, company)
CompanyMembershipSchema.index({ userId: 1, clientId: 1 }, { unique: true })
CompanyMembershipSchema.index({ userId: 1, status: 1 })
CompanyMembershipSchema.index({ clientId: 1, status: 1 })

export default mongoose.models.CompanyMembership ?? mongoose.model('CompanyMembership', CompanyMembershipSchema)
