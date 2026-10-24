import mongoose from 'mongoose'

/**
 * SalaryRevision — a change to an employee's monthly salary (increment,
 * promotion, adjustment or decrease) taking effect from a payroll month.
 *
 *   PENDING → APPROVED (letter numbered INCYYMM####) | REJECTED | CANCELLED
 *
 * An approved revision reaches Employee.salary (and the designation, for a
 * promotion) once its month has started — `appliedAt` (lib/hr/salaryRevisions.js
 * applyDueRevisions). Payroll asks for the salary of the slip's own month, so a
 * raise never leaks into an earlier month's slip.
 *
 * Changing the salary on the employee form is recorded too (source EDIT),
 * already approved and applied, so the history is complete.
 */
const SalaryRevisionSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    type:       { type: String, enum: ['INCREMENT', 'PROMOTION', 'ADJUSTMENT', 'DECREASE'], required: true },
    source:     { type: String, enum: ['REVISION', 'EDIT'], default: 'REVISION' },

    effectiveMonth: { type: String, required: true },   // 'YYYY-MM' — first payroll month at the new salary

    previousSalary: { type: Number, required: true },   // in effect just before effectiveMonth
    newSalary:      { type: Number, required: true },

    previousDesignation: { type: String, default: null },
    newDesignation:      { type: String, default: null },   // promotions

    reason: { type: String, default: null },

    status:  { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING' },
    // Several employees proposed together (an appraisal round) share a batch id.
    batchId: { type: String, default: null },

    requestedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },   // or rejected by
    approvedAt:   { type: Date, default: null },
    decisionNote: { type: String, default: null },
    cancelledBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt:  { type: Date, default: null },

    appliedAt: { type: Date, default: null },
    letterNo:  { type: String, default: undefined },   // INCYYMM#### (e.g. INC26100001), on approval
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

SalaryRevisionSchema.index({ employeeId: 1, effectiveMonth: 1 })
SalaryRevisionSchema.index({ status: 1, createdAt: -1 })
// One open proposal per employee at a time.
SalaryRevisionSchema.index({ employeeId: 1 }, { name: 'one_pending_per_employee', unique: true, partialFilterExpression: { status: 'PENDING' } })
SalaryRevisionSchema.index({ letterNo: 1 }, { unique: true, partialFilterExpression: { letterNo: { $type: 'string' } } })

if (mongoose.models.SalaryRevision) delete mongoose.models.SalaryRevision
export default mongoose.model('SalaryRevision', SalaryRevisionSchema)
