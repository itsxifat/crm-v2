import mongoose from 'mongoose'

const AttendanceSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date:       { type: Date, required: true },
    checkIn:    { type: Date, default: null },
    checkOut:   { type: Date, default: null },
    status:     { type: String, required: true },
    notes:      { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.Attendance ?? mongoose.model('Attendance', AttendanceSchema)
