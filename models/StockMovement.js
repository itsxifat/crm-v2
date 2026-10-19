import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'
import { dhakaParts } from '../lib/dhakaTime'
import { STOCK_MOVEMENT_TYPES, stockDirectionFor } from '../lib/inventory/constants'

const { ObjectId } = mongoose.Schema.Types

/**
 * One quantity movement of a consumable. Written by lib/inventory/stock.moveStock,
 * which also stamps qtyAfter / avgCostAfter from the atomic StockItem update.
 */
const StockMovementSchema = new mongoose.Schema(
  {
    movementNo:  { type: String, unique: true, sparse: true },          // 'SM-YYMM-#####'
    stockItemId: { type: ObjectId, ref: 'StockItem', required: true, index: true },
    type:        { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    direction:   { type: String, enum: ['IN', 'OUT'], required: true },
    qty: {
      type: Number, required: true,
      validate: { validator: v => Number.isFinite(v) && v > 0, message: 'Quantity must be greater than 0' },
    },
    unitCost:     { type: Number, default: 0, min: 0 },
    totalCost:    { type: Number, default: 0 },
    qtyAfter:     { type: Number, default: null },
    avgCostAfter: { type: Number, default: null },
    employeeId:     { type: ObjectId, ref: 'Employee', default: null },
    departmentId:   { type: ObjectId, ref: 'Department', default: null },
    projectId:      { type: ObjectId, ref: 'Project', default: null },
    purchaseBillId: { type: ObjectId, ref: 'PurchaseBill', default: null },
    reason:    { type: String, default: null },
    reference: { type: String, default: null },
    date:      { type: Date, required: true },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

StockMovementSchema.pre('validate', async function () {
  // Direction follows the type (TRANSFER legs must state it explicitly).
  const expected = stockDirectionFor(this.type)
  if (!this.direction && expected) this.direction = expected
  if (expected && this.direction && this.direction !== expected) {
    this.invalidate('direction', `A ${this.type} movement must be ${expected}`)
  }

  if (this.movementNo) return
  // Month boundaries follow the business timezone (Asia/Dhaka).
  const { year, month } = dhakaParts(new Date())
  const yymm   = `${String(year).slice(-2)}${String(month + 1).padStart(2, '0')}`
  const prefix = `SM-${yymm}-`
  // Highest number already issued for this prefix (NOT a count — see lib/sequence.js).
  const existing = await mongoose.model('StockMovement')
    .find({ movementNo: { $regex: `^${prefix}[0-9]+$` } })
    .select('movementNo').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(d.movementNo.slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`stockmove:${prefix}`, maxUsed)
  this.movementNo = `${prefix}${String(seq).padStart(5, '0')}`
})

StockMovementSchema.index({ stockItemId: 1, date: -1 })
StockMovementSchema.index({ type: 1, date: -1 })
StockMovementSchema.index({ employeeId: 1, date: -1 })
StockMovementSchema.index({ purchaseBillId: 1 })

if (mongoose.models.StockMovement) delete mongoose.models.StockMovement
export default mongoose.model('StockMovement', StockMovementSchema)
