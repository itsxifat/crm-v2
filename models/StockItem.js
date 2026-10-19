import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'

const { ObjectId } = mongoose.Schema.Types

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Quantity-tracked consumable (paper, toner, tea…). qtyOnHand / avgCost /
 * stockValue are maintained atomically by lib/inventory/stock.moveStock —
 * never edit them directly.
 */
const StockItemSchema = new mongoose.Schema(
  {
    // Auto-generated as `${categoryCode || 'ITM'}-0001` when not supplied.
    sku:               { type: String, required: true, unique: true, uppercase: true, trim: true },
    name:              { type: String, required: true, trim: true },
    categoryId:        { type: ObjectId, ref: 'AssetCategory', default: null },
    unit:              { type: String, default: 'pcs', trim: true },
    reorderLevel:      { type: Number, default: 0, min: 0 },
    reorderQty:        { type: Number, default: 0, min: 0 },
    preferredVendorId: { type: ObjectId, ref: 'Vendor', default: null },
    qtyOnHand:         { type: Number, default: 0, min: 0 },
    avgCost:           { type: Number, default: 0 },
    stockValue:        { type: Number, default: 0 },
    locationId:        { type: ObjectId, ref: 'InventoryLocation', default: null },
    isActive:          { type: Boolean, default: true },
    notes:             { type: String, default: null },
    // Set when a low-stock alert was sent; cleared when stock rises above reorderLevel
    // again, so managers are notified once per crossing.
    lowStockNotifiedAt: { type: Date, default: null },
    createdBy:         { type: ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

StockItemSchema.virtual('isLowStock').get(function () {
  return Number(this.reorderLevel) > 0 && Number(this.qtyOnHand) <= Number(this.reorderLevel)
})

StockItemSchema.pre('validate', async function () {
  if (this.sku && String(this.sku).trim()) return
  let code = 'ITM'
  if (this.categoryId) {
    const cat = await mongoose.model('AssetCategory').findById(this.categoryId).select('code').lean()
    const c = String(cat?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (c) code = c
  }
  const prefix = `${code}-`
  // Highest number already used for this prefix (NOT a count — see lib/sequence.js).
  const existing = await mongoose.model('StockItem')
    .find({ sku: { $regex: `^${escapeRegex(prefix)}[0-9]+$` } })
    .select('sku').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(d.sku.slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`sku:${code}`, maxUsed)
  this.sku = `${prefix}${String(seq).padStart(4, '0')}`
})

StockItemSchema.index({ categoryId: 1 })
StockItemSchema.index({ isActive: 1, name: 1 })

if (mongoose.models.StockItem) delete mongoose.models.StockItem
export default mongoose.model('StockItem', StockItemSchema)
