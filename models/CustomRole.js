import mongoose from 'mongoose'

const CustomRoleSchema = new mongoose.Schema(
  {
    department:  { type: String, required: true, trim: true },
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: null },
    venture:     { type: String, enum: ['ENSTUDIO', 'ENTECH', 'ENMARK', null], default: null },
    color:       { type: String, default: '#6366f1' },
    isActive:    { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Flat array of permission strings — e.g. ['sales.leads.view', 'projects.create']
    permissions: { type: [String], default: [] },
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
