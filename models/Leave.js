import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const LeaveSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    type:       { type: String, required: true }, // encrypted
    startDate:  { type: Date, required: true },
    endDate:    { type: Date, required: true },
    reason:     { type: String, default: null },  // encrypted
    status: {
      type:    String,
      enum:    ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    approvedBy: { type: String, default: null },  // encrypted
    approvedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

LeaveSchema.plugin(encryptionPlugin, {
  collection: 'leaves',
  fields: [
    { path: 'type'       },
    { path: 'reason'     },
    { path: 'approvedBy' },
  ],
})

export default mongoose.models.Leave ?? mongoose.model('Leave', LeaveSchema)
