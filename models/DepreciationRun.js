import mongoose from 'mongoose'
import { DEPRECIATION_RUN_STATUSES } from '../lib/inventory/constants'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

const RunLineSchema = new Schema({
  assetId:          { type: ObjectId, ref: 'Asset', required: true },
  amount:           { type: Number, default: 0 },
  accumulatedAfter: { type: Number, default: null },
  // Catch-up: first month included in `amount` when earlier months were missed
  // (null ⇒ only the run's own period), and how many months it covers.
  fromPeriod:       { type: String, default: null },
  months:           { type: Number, default: 1 },
  // State before the run, saved when the run is claimed so an interrupted run
  // (status POSTING) can be undone exactly.
  accumulatedBefore: { type: Number, default: null },
  prevPeriod:        { type: String, default: null },
  fullyBefore:       { type: Boolean, default: false },
}, { _id: false, id: false })

/** One posted book-depreciation run per Dhaka month (idempotent via the unique period). */
const DepreciationRunSchema = new Schema(
  {
    period:      { type: String, required: true, unique: true, match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM'] },
    status:      { type: String, enum: DEPRECIATION_RUN_STATUSES, default: 'POSTED' },
    totalAmount: { type: Number, default: 0 },
    assetCount:  { type: Number, default: 0 },
    lines:       { type: [RunLineSchema], default: [] },
    transactionId: { type: ObjectId, ref: 'Transaction', default: null },
    runBy:       { type: ObjectId, ref: 'User', default: null },
    notes:       { type: String, default: null },
    reversedAt:     { type: Date, default: null },
    reversedBy:     { type: ObjectId, ref: 'User', default: null },
    reversalReason: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

DepreciationRunSchema.index({ 'lines.assetId': 1 })
DepreciationRunSchema.index({ status: 1, period: -1 })

if (mongoose.models.DepreciationRun) delete mongoose.models.DepreciationRun
export default mongoose.model('DepreciationRun', DepreciationRunSchema)
