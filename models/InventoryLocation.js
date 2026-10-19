import mongoose from 'mongoose'
import { LOCATION_TYPES } from '../lib/inventory/constants'

const MAX_DEPTH = 25

const InventoryLocationSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    // Optional short code (sparse unique) — no default, so locations without a
    // code leave the field absent instead of colliding on null.
    code:     { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    type:     { type: String, enum: LOCATION_TYPES, default: 'OFFICE' },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', default: null },
    address:  { type: String, default: null },
    isActive: { type: Boolean, default: true },
    notes:    { type: String, default: null },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

InventoryLocationSchema.pre('validate', async function () {
  // Empty code ⇒ field absent (keeps the sparse unique index happy).
  if (this.code == null || String(this.code).trim() === '') this.code = undefined
  else this.code = String(this.code).toUpperCase().replace(/\s+/g, '')

  if (!this.parentId) return
  if (String(this.parentId) === String(this._id)) {
    this.invalidate('parentId', 'A location cannot be its own parent')
    return
  }
  if (!this.isNew && !this.isModified('parentId')) return
  // Walk up the ancestors to refuse cycles (A → B → A).
  const Location = mongoose.model('InventoryLocation')
  let cursor = this.parentId
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
    if (String(cursor) === String(this._id)) {
      this.invalidate('parentId', 'This parent would create a loop of locations')
      return
    }
    const parent = await Location.findById(cursor).select('parentId').lean()
    if (!parent) {
      if (depth === 0) this.invalidate('parentId', 'Parent location not found')
      return
    }
    cursor = parent.parentId
  }
})

InventoryLocationSchema.index({ parentId: 1 })
InventoryLocationSchema.index({ isActive: 1, name: 1 })

if (mongoose.models.InventoryLocation) delete mongoose.models.InventoryLocation
export default mongoose.model('InventoryLocation', InventoryLocationSchema)
