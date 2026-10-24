import mongoose from 'mongoose'
import { nextSequence, counterValue } from '../lib/sequence'
import { dhakaParts } from '../lib/dhakaTime'
import { AUDIT_STATUSES, AUDIT_RESULTS } from '../lib/inventory/constants'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

/** Name of the "one running audit per scope" unique index (POST /api/inventory/audits maps its E11000 to 409). */
export const SCOPE_INDEX = 'scope_1_in_progress'

const AuditLineSchema = new Schema({
  assetId:            { type: ObjectId, ref: 'Asset', required: true },
  assetTag:           { type: String, default: null },
  assetName:          { type: String, default: null },
  expectedLocationId: { type: ObjectId, ref: 'InventoryLocation', default: null },
  expectedEmployeeId: { type: ObjectId, ref: 'Employee', default: null },
  result:             { type: String, enum: AUDIT_RESULTS, default: 'PENDING' },
  foundLocationId:    { type: ObjectId, ref: 'InventoryLocation', default: null },
  condition:          { type: String, default: null },
  note:               { type: String, default: null },
  checkedAt:          { type: Date, default: null },
  checkedBy:          { type: ObjectId, ref: 'User', default: null },
}, { _id: false, id: false })

const UnexpectedSchema = new Schema({
  tag:         { type: String, default: null },
  description: { type: String, default: null },
  note:        { type: String, default: null },
}, { _id: false, id: false })

const SummarySchema = new Schema({
  total:         { type: Number, default: 0 },
  found:         { type: Number, default: 0 },
  missing:       { type: Number, default: 0 },
  wrongLocation: { type: Number, default: 0 },
  damaged:       { type: Number, default: 0 },
  pending:       { type: Number, default: 0 },
}, { _id: false, id: false })

/** Physical verification session (count the floor against the register and back). */
const AssetAuditSchema = new Schema(
  {
    auditNo:     { type: String, unique: true, sparse: true },        // 'AUDYYMM###'
    name:        { type: String, required: true, trim: true },
    locationId:  { type: ObjectId, ref: 'InventoryLocation', default: null },
    categoryId:  { type: ObjectId, ref: 'AssetCategory', default: null },
    status:      { type: String, enum: AUDIT_STATUSES, default: 'IN_PROGRESS' },
    startedAt:   { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    completedBy: { type: ObjectId, ref: 'User', default: null },
    lines:       { type: [AuditLineSchema], default: [] },
    unexpected:  { type: [UnexpectedSchema], default: [] },
    summary:     { type: SummarySchema, default: () => ({}) },
    notes:       { type: String, default: null },
    createdBy:   { type: ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

/** Recount summary from lines (derived data — always in step on save). */
AssetAuditSchema.methods.recomputeSummary = function () {
  const s = { total: 0, found: 0, missing: 0, wrongLocation: 0, damaged: 0, pending: 0 }
  for (const l of this.lines ?? []) {
    s.total++
    if (l.result === 'FOUND') s.found++
    else if (l.result === 'MISSING') s.missing++
    else if (l.result === 'WRONG_LOCATION') s.wrongLocation++
    else if (l.result === 'DAMAGED') s.damaged++
    else s.pending++
  }
  this.summary = s
  return s
}

AssetAuditSchema.pre('validate', async function () {
  this.recomputeSummary()

  if (this.auditNo) return
  // Month boundaries follow the business timezone (Asia/Dhaka).
  const { year, month } = dhakaParts(new Date())
  const yymm   = `${String(year).slice(-2)}${String(month + 1).padStart(2, '0')}`
  const prefix = `AUD${yymm}`
  const re     = new RegExp(`^AUD-?${yymm}-?(\\d{3,})$`)
  // Highest number already issued this month (NOT a count — see lib/sequence.js),
  // in either shape: audits numbered before 2026-10 read AUD-2610-001, and the old
  // counter key (assetaudit:AUD-2610-) is a floor too.
  const existing = await mongoose.model('AssetAudit')
    .find({ auditNo: { $regex: re.source } })
    .select('auditNo').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(re.exec(d.auditNo)?.[1], 10) || 0), 0)
  const floor = Math.max(maxUsed, await counterValue(`assetaudit:AUD-${yymm}-`))
  const seq = await nextSequence(`assetaudit:${prefix}`, floor)
  this.auditNo = `${prefix}${String(seq).padStart(3, '0')}`
})

AssetAuditSchema.index({ status: 1, createdAt: -1 })
AssetAuditSchema.index({ 'lines.assetId': 1 })
// One running audit per exact scope (null location / null category = "all"), like Reconciliation.
// Complete/cancel only move audits out of IN_PROGRESS, never back.
AssetAuditSchema.index(
  { locationId: 1, categoryId: 1 },
  { name: SCOPE_INDEX, unique: true, partialFilterExpression: { status: 'IN_PROGRESS' } },
)

if (mongoose.models.AssetAudit) delete mongoose.models.AssetAudit
export default mongoose.model('AssetAudit', AssetAuditSchema)
