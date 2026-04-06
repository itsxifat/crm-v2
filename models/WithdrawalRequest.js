import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const WithdrawalRequestSchema = new mongoose.Schema(
  {
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', required: true },
    // Financial — encrypted
    amount:         { type: mongoose.Schema.Types.Mixed, required: true },
    method:         { type: String, required: true },
    details:        { type: String, default: null },
    status: {
      type:    String,
      enum:    ['PENDING', 'APPROVED', 'PAID', 'REJECTED'],
      default: 'PENDING',
    },
    projectId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Project',             default: null },
    assignmentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'FreelancerAssignment', default: null },
    paymentDetails: { type: String, default: null }, // encrypted
    transactionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    adminNote:      { type: String, default: null }, // encrypted
    processedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt:    { type: Date, default: null },
    isDirectPayment:{ type: Boolean, default: false },
    // Mixed — encrypted JSON array
    allocations:    { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

WithdrawalRequestSchema.plugin(encryptionPlugin, {
  collection: 'withdrawalrequests',
  fields: [
    { path: 'amount',         type: 'number' },
    { path: 'method'          },
    { path: 'details'         },
    { path: 'paymentDetails'  },
    { path: 'adminNote'       },
    { path: 'allocations',    type: 'array'  },
  ],
})

export default mongoose.models.WithdrawalRequest ?? mongoose.model('WithdrawalRequest', WithdrawalRequestSchema)
