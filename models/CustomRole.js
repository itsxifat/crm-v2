import mongoose from 'mongoose'

// Permission keys per module
const permBool = { type: Boolean, default: false }

const PermissionsSchema = new mongoose.Schema({
  dashboard:  { view: permBool, viewStats: permBool, exportData: permBool },
  projects:   { view: permBool, create: permBool, edit: permBool, delete: permBool, viewFinancials: permBool, managePayments: permBool },
  clients:    { view: permBool, create: permBool, edit: permBool, delete: permBool, viewKYC: permBool, manageKYC: permBool },
  invoices:   { view: permBool, create: permBool, edit: permBool, delete: permBool, export: permBool },
  employees:  { view: permBool, create: permBool, edit: permBool, delete: permBool },
  accounts:   { view: permBool, addTransaction: permBool, exportReports: permBool },
  leads:      { view: permBool, create: permBool, edit: permBool, delete: permBool },
  roles:      { view: permBool, manage: permBool },
}, { _id: false })

const CustomRoleSchema = new mongoose.Schema(
  {
    department:  { type: String, required: true, trim: true },
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: null },
    venture:     { type: String, enum: ['ENSTUDIO', 'ENTECH', 'ENMARK', null], default: null },
    color:       { type: String, default: '#6366f1' },
    isActive:    { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    permissions: { type: PermissionsSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

if (mongoose.models.CustomRole) delete mongoose.models.CustomRole
export default mongoose.model('CustomRole', CustomRoleSchema)
