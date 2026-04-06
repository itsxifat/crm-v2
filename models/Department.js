import mongoose from 'mongoose'

// Auto-generate short code from department name
// "Development"         → "DEV"
// "Human Resources"     → "HR"
// "Marketing"           → "MKT"
// "Information Tech"    → "IT"
// "Finance & Accounting"→ "FA"
export function generateShortCode(name) {
  if (!name) return ''
  const words = name.trim().split(/[\s&\/\-_]+/).filter(Boolean)
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase()
  }
  return words.map(w => w[0]).join('').toUpperCase()
}

const DepartmentSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, unique: true, trim: true },
    shortCode:   { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: null },
    isActive:    { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

DepartmentSchema.index({ shortCode: 1 }, { unique: true })
DepartmentSchema.index({ isActive: 1 })

if (mongoose.models.Department) delete mongoose.models.Department
export default mongoose.model('Department', DepartmentSchema)
