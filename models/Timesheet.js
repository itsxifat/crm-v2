import mongoose from 'mongoose'

const TimesheetSchema = new mongoose.Schema(
  {
    taskId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', default: null },
    employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    hours:        { type: Number, required: true },
    description:  { type: String, default: null },
    date:         { type: Date, required: true },
    approved:     { type: Boolean, default: false },
    approvedBy:   { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Timesheet ?? mongoose.model('Timesheet', TimesheetSchema)
