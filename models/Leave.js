import mongoose from 'mongoose'

const LeaveSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    type:       { type: String, required: true },
    startDate:  { type: Date, required: true },
    endDate:    { type: Date, required: true },
    reason:     { type: String, default: null },
    status:     {
      type:    String,
      enum:    ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    approvedBy: { type: String, default: null },
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

export default mongoose.models.Leave ?? mongoose.model('Leave', LeaveSchema)
