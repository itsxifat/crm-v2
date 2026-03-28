import mongoose from 'mongoose'

const ProjectExpenseSchema = new mongoose.Schema(
  {
    projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    venture:     { type: String, enum: ['ENSTUDIO','ENTECH','ENMARK'], default: null },

    title:       { type: String, required: true, trim: true },
    amount:      { type: Number, required: true },
    category:    { type: String, required: true },
    date:        { type: Date,   required: true },
    notes:       { type: String, default: null },
    invoiceUrl:  { type: String, default: null },          // invoice/receipt uploaded by submitter

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status:      { type: String, enum: ['PENDING','APPROVED','REJECTED'], default: 'PENDING' },

    reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:  { type: Date,   default: null },
    reviewNote:  { type: String, default: null },
    receiptUrl:  { type: String, default: null },          // receipt uploaded by approver

    // After approval, synced to Transaction in accounts module
    syncedToAccounts:     { type: Boolean, default: false },
    accountsTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
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

if (mongoose.models.ProjectExpense) delete mongoose.models.ProjectExpense
export default mongoose.model('ProjectExpense', ProjectExpenseSchema)
