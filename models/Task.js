import mongoose from 'mongoose'
const TaskSchema = new mongoose.Schema(
  {
    projectId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Project',    required: true },
    // Encrypted content
    title:                { type: String, required: true, trim: true },
    description:          { type: String, default: null },
    status: {
      type:    String,
      enum:    ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED'],
      default: 'TODO',
    },
    priority: {
      type:    String,
      enum:    ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
      default: 'MEDIUM',
    },
    dueDate:              { type: Date, default: null },
    // Mixed — encrypted Numbers
    estimatedHours:       { type: mongoose.Schema.Types.Mixed, default: null },
    actualHours:          { type: mongoose.Schema.Types.Mixed, default: null },
    // Tasks are assigned to in-house employees only. Freelancers/agencies are
    // engaged at the project level (FreelancerAssignment), not via tasks.
    assignedEmployeeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee',   default: null },
    assignedFreelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', default: null }, // deprecated
    // Assignee acceptance flow — the employee must accept the task before it's theirs.
    assignmentStatus:     { type: String, enum: ['ASSIGNED', 'ACCEPTED', 'DECLINED'], default: 'ASSIGNED' },
    acceptedAt:           { type: Date, default: null },
    declinedAt:           { type: Date, default: null },
    isClientVisible:      { type: Boolean, default: false },
    // Free-text, comma-separated tags (entered in the task modal).
    tags:                 { type: String,  default: null },
    position:             { type: Number,  default: 0 },
    // Set when the task moves into COMPLETED (cleared when it leaves it) — used
    // for "completed this month" metrics; updatedAt changes on any edit.
    completedAt:          { type: Date,    default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// Keep completedAt in sync with status transitions.
TaskSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.completedAt = this.status === 'COMPLETED' ? (this.completedAt ?? new Date()) : null
  }
  next()
})

TaskSchema.pre(['findOneAndUpdate', 'updateOne'], async function () {
  const update = this.getUpdate() ?? {}
  const status = update.$set?.status ?? update.status
  if (status === undefined) return
  if (status !== 'COMPLETED') {
    this.set('completedAt', null)
    return
  }
  // Only stamp on the transition INTO COMPLETED (reorders/edits within the column keep it)
  const current = await this.model.findOne(this.getQuery()).select('status').lean()
  if (current?.status === 'COMPLETED') return
  this.set('completedAt', new Date())
})

export default mongoose.models.Task ?? mongoose.model('Task', TaskSchema)
