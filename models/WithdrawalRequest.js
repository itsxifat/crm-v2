import mongoose from 'mongoose'

const WithdrawalRequestSchema = new mongoose.Schema(
  {
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', required: true },
    amount:       { type: Number, required: true },
    method:       { type: String, required: true },
    details:      { type: String, default: null },
    status:       {
      type:    String,
      enum:    ['PENDING', 'APPROVED', 'PAID', 'REJECTED'],
      default: 'PENDING',
    },
    projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FreelancerAssignment', default: null },
    paymentDetails: { type: String, default: null },
    transactionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    adminNote:   { type: String, default: null },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
    isDirectPayment: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.WithdrawalRequest ?? mongoose.model('WithdrawalRequest', WithdrawalRequestSchema)
