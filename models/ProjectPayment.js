import mongoose from 'mongoose'

const ProjectPaymentSchema = new mongoose.Schema(
  {
    projectId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project',  default: null },
    invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice',  default: null },
    clientId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Client',   default: null },
    submittedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',     default: null },

    amount:        { type: Number, required: true },
    currency:      { type: String, default: 'BDT' },
    paymentMethod: { type: String, default: 'BANK_TRANSFER' },
    paymentDate:   { type: Date, default: Date.now },
    description:   { type: String, default: null },
    notes:         { type: String, default: null },

    // Proof uploaded by client/submitter at submission time
    receiptUrl:    { type: String, default: null },

    status: {
      type:    String,
      enum:    ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'],
      default: 'PENDING_CONFIRMATION',
    },

    // Set on confirmation/rejection
    confirmedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt:    { type: Date, default: null },
    rejectionNote:  { type: String, default: null },

    // Transaction created in accounts on confirmation
    transactionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

if (mongoose.models.ProjectPayment) delete mongoose.models.ProjectPayment
export default mongoose.model('ProjectPayment', ProjectPaymentSchema)
