import mongoose from 'mongoose'

const AttendanceSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date:       { type: Date, required: true },
    // Business-day key ('YYYY-MM-DD', Asia/Dhaka) — one record per employee per day.
    day:        { type: String, default: undefined },
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

// Records created before `day` existed have no key and are not constrained.
AttendanceSchema.index(
  { employeeId: 1, day: 1 },
  { unique: true, partialFilterExpression: { day: { $type: 'string' } } }
)
AttendanceSchema.index({ employeeId: 1, date: -1 })

export default mongoose.models.Attendance ?? mongoose.model('Attendance', AttendanceSchema)
