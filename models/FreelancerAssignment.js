import mongoose from 'mongoose'

const FreelancerAssignmentSchema = new mongoose.Schema({
  projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project',   required: true },
  freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', required: true },
  assignedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',       required: true },
  // Agreed fixed amount for this engagement. Null for salary-based freelancers
  // (their salary covers the work — paymentStatus is then NOT_REQUIRED).
  paymentAmount: { type: Number, default: null },
  currency:      { type: String, default: 'BDT' },   // currency of paymentAmount
  amountBDT:     { type: Number, default: null },     // BDT-equivalent of paymentAmount
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
  // PENDING → work not yet sent to payment. PAYMENT_REQUESTED → expense awaiting
  // account-manager approval. PAID → settled. NOT_REQUIRED → salary engagement.
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'PAYMENT_REQUESTED', 'PAID', 'NOT_REQUIRED'],
    default: 'PENDING',
  },
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
