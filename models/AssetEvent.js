import mongoose from 'mongoose'
import { EVENT_TYPES } from '../lib/inventory/constants'

const { ObjectId, Mixed } = mongoose.Schema.Types

/**
 * Append-only history of an asset. The Asset document holds the current state;
 * these events are the audit trail. Corrections are made with new events
 * (e.g. RECOVERY_UPDATED, VALUE_ADJUSTED), never by rewriting old ones —
 * there are no update routes for events.
 *
 * details by type:
 *   DAMAGE_REPORTED: { cause, responsibleEmployeeId, liabilityPct, assessedLoss,
 *                      recovery: { method, amount, status: 'PENDING'|'RECOVERED'|'WAIVED'|'NOT_APPLICABLE',
 *                                  recoveredAt, transactionId, note },
 *                      gdNumber, enquiryNote, reportedByEmployee }
 *   REPAIR_SENT / REPAIR_COMPLETED: { repairRef, vendorName, expectedDate, cost, capitalize }
 */
const AssetEventSchema = new mongoose.Schema(
  {
    assetId: { type: ObjectId, ref: 'Asset', required: true, index: true },
    type:    { type: String, enum: EVENT_TYPES, required: true },
    date:    { type: Date, required: true, default: Date.now },

    fromStatus:     { type: String, default: null },
    toStatus:       { type: String, default: null },
    fromLocationId: { type: ObjectId, ref: 'InventoryLocation', default: null },
    toLocationId:   { type: ObjectId, ref: 'InventoryLocation', default: null },
    fromEmployeeId: { type: ObjectId, ref: 'Employee', default: null },
    toEmployeeId:   { type: ObjectId, ref: 'Employee', default: null },
    departmentId:   { type: ObjectId, ref: 'Department', default: null },
    condition:      { type: String, default: null },

    amount:   { type: Number, default: null },
    vendorId: { type: ObjectId, ref: 'Vendor', default: null },
    details:  { type: Mixed, default: () => ({}) },
    attachments: { type: [String], default: [] },
    notes:    { type: String, default: null },

    transactionId: { type: ObjectId, ref: 'Transaction', default: null },
    expenseId:     { type: ObjectId, ref: 'ProjectExpense', default: null },

    createdBy:     { type: ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

AssetEventSchema.index({ assetId: 1, date: -1, createdAt: -1 })
AssetEventSchema.index({ type: 1, date: -1 })
AssetEventSchema.index({ toEmployeeId: 1, date: -1 })
AssetEventSchema.index({ 'details.responsibleEmployeeId': 1 }, { sparse: true })

if (mongoose.models.AssetEvent) delete mongoose.models.AssetEvent
export default mongoose.model('AssetEvent', AssetEventSchema)
