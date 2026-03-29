import mongoose from 'mongoose'

const ProjectSchema = new mongoose.Schema(
  {
    // Human-readable project code (auto-generated: ENS-0001, ENT-0001, ENM-0001)
    projectCode:      { type: String, unique: true, sparse: true },

    // Core
    name:             { type: String, required: true, trim: true },
    description:      { type: String, default: null },
    clientId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },

    // Venture & classification
    venture:          { type: String, enum: ['ENSTUDIO', 'ENTECH', 'ENMARK'], required: true },
    category:         { type: String, required: true },
    subcategory:      { type: String, default: null },
    projectType:      { type: String, enum: ['FIXED', 'MONTHLY'], required: true },

    // Team
    projectManagerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    teamMembers:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Status & priority
    status:    {
      type:    String,
      enum:    ['PENDING','IN_PROGRESS','IN_REVIEW','REVISION','APPROVED','DELIVERED','ACTIVE','EXPIRING_SOON','RENEWED','ON_HOLD','CANCELLED','FEEDBACK','SUBMITTED'],
      default: 'PENDING',
    },
    priority:  { type: String, enum: ['LOW','MEDIUM','HIGH','URGENT'], default: 'MEDIUM' },

    // Dates
    orderDate: { type: Date, default: Date.now, immutable: true }, // auto-set on creation, never changed
    startDate: { type: Date, default: Date.now },
    deadline:  { type: Date, default: null },           // required for FIXED

    // Dates — MONTHLY
    billingDay:          { type: Number, default: null },  // day of month billing started
    currentPeriodStart:  { type: Date,   default: null },
    currentPeriodEnd:    { type: Date,   default: null },
    nextBillingDate:     { type: Date,   default: null },
    renewalStatus:       { type: String, enum: ['ACTIVE','EXPIRING_SOON','RENEWED','CANCELLED'], default: null },

    // Financials
    budget:           { type: Number, default: 0 },
    discount:         { type: Number, default: 0 },
    approvedExpenses: { type: Number, default: 0 },   // synced from ProjectExpense approvals
    paidAmount:       { type: Number, default: 0 },   // synced from confirmed ProjectPayments
    currency:         { type: String, default: 'BDT' },

    // Brief — written by project manager, visible to all assigned members
    brief: { type: String, default: null },
    briefUpdatedAt: { type: Date, default: null },
    briefUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Meta
    tags:       { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

// Auto-generate projectCode before first save
// Format: ENSP-2603A01
//   ENS/ENT/ENM = venture, P = project, 2603 = YYMM, A01..A99 B01.. = unlimited sequence
const VENTURE_PREFIX = { ENSTUDIO: 'ENS', ENTECH: 'ENT', ENMARK: 'ENM' }

function _toAlpha(n) {
  // 0→'A', 1→'B', ..., 25→'Z', 26→'AA', ...
  let s = ''; n++
  while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26) }
  return s
}
function _seqCode(count) {
  // A01..A99 → B01..B99 → ... (99 per letter group)
  return `${_toAlpha(Math.floor(count / 99))}${String((count % 99) + 1).padStart(2, '0')}`
}

ProjectSchema.pre('save', async function () {
  if (this.projectCode) return
  const venturePrefix = VENTURE_PREFIX[this.venture] ?? 'PRJ'
  const d    = new Date(this.orderDate ?? Date.now())
  const yymm = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
  const pfx  = `${venturePrefix}P-${yymm}`
  const count = await mongoose.model('Project').countDocuments({
    projectCode: { $regex: `^${pfx}` },
  })
  this.projectCode = `${pfx}${_seqCode(count)}`
})

// Virtual: real-time profit (revenue - expenses)
ProjectSchema.virtual('profit').get(function () {
  return (this.paidAmount ?? 0) - (this.approvedExpenses ?? 0)
})

// Virtual: due amount (what the client still owes)
ProjectSchema.virtual('dueAmount').get(function () {
  return Math.max(0, (this.budget ?? 0) - (this.discount ?? 0) - (this.paidAmount ?? 0))
})

// Virtual: budget utilization %
ProjectSchema.virtual('budgetUtilization').get(function () {
  if (!this.budget || this.budget === 0) return 0
  return Math.round((this.approvedExpenses / this.budget) * 100)
})

// Force re-registration to pick up updated schema
if (mongoose.models.Project) delete mongoose.models.Project
export default mongoose.model('Project', ProjectSchema)
