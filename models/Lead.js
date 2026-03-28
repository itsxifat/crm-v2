import mongoose from 'mongoose'

const LeadActivitySchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    type:        { type: String, required: true },
    note:        { type: String, required: true },
    createdById: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true, transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret } } }
)

const LeadSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    email:        { type: String, default: null },
    phone:        { type: String, default: null },
    company:      { type: String, default: null },
    industry:     { type: String, default: null },
    source:       { type: String, default: null },
    status:       {
      type:    String,
      enum:    ['NEW', 'CONTACTED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST'],
      default: 'NEW',
    },
    value:        { type: Number, default: null },
    notes:        { type: String, default: null },
    assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    followUpDate: { type: Date, default: null },
    lostReason:   { type: String, default: null },
    convertedAt:  { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export const LeadActivity = mongoose.models.LeadActivity ?? mongoose.model('LeadActivity', LeadActivitySchema)
export default mongoose.models.Lead ?? mongoose.model('Lead', LeadSchema)
