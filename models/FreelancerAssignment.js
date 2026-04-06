import mongoose from 'mongoose'

const FreelancerAssignmentSchema = new mongoose.Schema({
  projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project',   required: true },
  freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', required: true },
  assignedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',       required: true },
  paymentAmount: { type: Number, required: true },
  paymentNotes:  { type: String, default: null },
  status: {
    type: String,
    enum: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'ASSIGNED',
  },
  acceptedAt:  { type: Date, default: null },
  completedAt: { type: Date, default: null },
  approvedAt:  { type: Date, default: null },
  approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'PAYMENT_REQUESTED', 'IN_WALLET', 'WITHDRAWAL_REQUESTED', 'PAID'],
    default: 'PENDING',
  },
  withdrawalRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'WithdrawalRequest', default: null },
  expenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectExpense', default: null },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(_, ret) {
      ret.id = ret._id?.toString()
      delete ret._id
      delete ret.__v
      return ret
    },
  },
})

if (mongoose.models.FreelancerAssignment) delete mongoose.models.FreelancerAssignment
export default mongoose.model('FreelancerAssignment', FreelancerAssignmentSchema)
