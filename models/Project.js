import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const ProjectSchema = new mongoose.Schema(
  {
    projectCode: { type: String, unique: true, sparse: true },

    // Encrypted content fields
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: null },
    clientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },

    venture:     { type: String, required: true },
    category:    { type: String, required: true },
    subcategory: { type: String, default: null },
    projectType: { type: String, enum: ['FIXED', 'MONTHLY'], required: true },

    projectManagerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    teamMembers:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    status: {
      type:    String,
      enum:    ['PENDING','IN_PROGRESS','IN_REVIEW','REVISION','APPROVED','DELIVERED','ACTIVE','EXPIRING_SOON','RENEWED','ON_HOLD','CANCELLED','FEEDBACK','SUBMITTED'],
      default: 'PENDING',
    },
    priority: { type: String, enum: ['LOW','MEDIUM','HIGH','URGENT'], default: 'MEDIUM' },

    orderDate:  { type: Date, default: Date.now, immutable: true },
    startDate:  { type: Date, default: Date.now },
    deadline:   { type: Date, default: null },

    billingDay:         { type: Number, default: null },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd:   { type: Date, default: null },
    nextBillingDate:    { type: Date, default: null },
    renewalStatus:      { type: String, enum: ['ACTIVE','EXPIRING_SOON','RENEWED','CANCELLED'], default: null },

    // Financial fields — Mixed (encrypted Number)
    budget:           { type: mongoose.Schema.Types.Mixed, default: 0 },
    discount:         { type: mongoose.Schema.Types.Mixed, default: 0 },
    approvedExpenses: { type: mongoose.Schema.Types.Mixed, default: 0 },
    paidAmount:       { type: mongoose.Schema.Types.Mixed, default: 0 },
    currency:         { type: String, default: 'BDT' },

    brief:          { type: String, default: null },
    briefUpdatedAt: { type: Date, default: null },
    briefUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    tags:         { type: String, default: null },
    cancelledAt:  { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

function _toAlpha(n) { let s = ''; n++; while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26) } return s }
function _seqCode(count) { return `${_toAlpha(Math.floor(count / 99))}${String((count % 99) + 1).padStart(2, '0')}` }

// Derive a 3-char prefix from a venture ID as a last-resort fallback
// e.g. "ENSTUDIO" → "ENS", "ENTECH" → "ENT", "CRDESIGN" → "CRD"
function _fallbackPrefix(ventureId) {
  return (ventureId ?? 'PRJ').slice(0, 3).toUpperCase()
}

ProjectSchema.pre('save', async function () {
  if (this.projectCode) return

  // Look up the venture's prefix from the CRM config stored in Settings
  let venturePrefix
  try {
    const setting = await mongoose.model('Setting').findOne({ key: 'crm_config' }).lean()
    if (setting?.value) {
      const cfg     = JSON.parse(setting.value)
      const venture = (cfg.ventures ?? []).find(v => v.id === this.venture)
      if (venture?.prefix) venturePrefix = venture.prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    }
  } catch { /* ignore — fall back below */ }

  if (!venturePrefix) venturePrefix = _fallbackPrefix(this.venture)

  const d    = new Date(this.orderDate ?? Date.now())
  const yymm = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
  const pfx  = `${venturePrefix}P-${yymm}`
  const count = await mongoose.model('Project').countDocuments({ projectCode: { $regex: `^${pfx}` } })
  this.projectCode = `${pfx}${_seqCode(count)}`
})

ProjectSchema.virtual('profit').get(function () {
  return (this.paidAmount ?? 0) - (this.approvedExpenses ?? 0)
})
ProjectSchema.virtual('dueAmount').get(function () {
  return Math.max(0, (this.budget ?? 0) - (this.discount ?? 0) - (this.paidAmount ?? 0))
})
ProjectSchema.virtual('budgetUtilization').get(function () {
  if (!this.budget || this.budget === 0) return 0
  return Math.round((this.approvedExpenses / this.budget) * 100)
})

ProjectSchema.plugin(encryptionPlugin, {
  collection: 'projects',
  fields: [
    { path: 'name'          },
    { path: 'description'   },
    { path: 'category'      },
    { path: 'subcategory'   },
    { path: 'currency'      },
    { path: 'brief'         },
    { path: 'tags'          },
    { path: 'cancelReason'  },
    { path: 'budget',           type: 'number' },
    { path: 'discount',         type: 'number' },
    { path: 'approvedExpenses', type: 'number' },
    { path: 'paidAmount',       type: 'number' },
  ],
})

if (mongoose.models.Project) delete mongoose.models.Project
export default mongoose.model('Project', ProjectSchema)
