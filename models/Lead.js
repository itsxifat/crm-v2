import mongoose from 'mongoose'

const CommentSchema = new mongoose.Schema(
  {
    text:       { type: String, required: true },
    authorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true, transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; return ret } },
  }
)

const LeadActivitySchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    type:        { type: String, required: true },
    note:        { type: String, required: true },
    createdById: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true, transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret } },
  }
)

const LeadSchema = new mongoose.Schema(
  {
    // ── Core contact ───────────────────────────────────────────────────────────
    name:             { type: String, required: true, trim: true },
    designation:      { type: String, default: null },   // e.g. "CEO", "Marketing Head"
    email:            { type: String, default: null },
    phone:            { type: String, default: null },
    alternativePhone: { type: String, default: null },
    company:          { type: String, default: null },
    location:         { type: String, default: null },   // city / country

    // ── Lead classification ────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['NEW', 'CONTACTED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST'],
      default: 'NEW',
    },
    priority: {
      type:    String,
      enum:    ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
      default: 'NORMAL',
    },
    category:    { type: String, default: null },   // service label within the venture (e.g. "Web Development")
    subcategory: { type: String, default: null },   // subcategory within the service (e.g. "Landing Page")
    service:     { type: String, default: null },   // venture id / sister concern (e.g. "ENTECH")

    // ── Source & tracking ─────────────────────────────────────────────────────
    source:    { type: String, default: null },  // channel: Referral, Cold Outreach…
    platform:  { type: String, default: null },  // Facebook, LinkedIn, WhatsApp…
    reference: { type: String, default: null },  // who referred / referred by

    // ── Multiple links ────────────────────────────────────────────────────────
    links: [{ type: String }],                   // FB page, LinkedIn, portfolio…

    // ── Dates ─────────────────────────────────────────────────────────────────
    sendingDate: { type: Date, default: null },  // date proposal / message was sent
    followUpDate: { type: Date, default: null },

    // ── Financials & assignment ────────────────────────────────────────────────
    value:        { type: Number, default: null },
    notes:        { type: String, default: null },
    assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

    // ── Outcome ───────────────────────────────────────────────────────────────
    lostReason:  { type: String, default: null },
    convertedAt: { type: Date, default: null },

    // ── Inline comments ───────────────────────────────────────────────────────
    comments: { type: [CommentSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// Index for fast filtering
LeadSchema.index({ status: 1, priority: 1 })
LeadSchema.index({ platform: 1 })
LeadSchema.index({ assignedToId: 1 })

export const LeadActivity = mongoose.models.LeadActivity ?? mongoose.model('LeadActivity', LeadActivitySchema)
export default mongoose.models.Lead ?? mongoose.model('Lead', LeadSchema)
