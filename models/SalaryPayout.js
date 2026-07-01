import mongoose from 'mongoose'

// Recurring salary payout for a temporary salary-based freelancer. One row per
// (freelancer, period); generated automatically on/after the salary day by the
// cron endpoint, then approved by an account manager which creates the EXPENSE
// Transaction and marks it PAID. The unique (freelancerId, period) index makes
// generation idempotent — re-running the cron never double-creates a payout.
const SalaryPayoutSchema = new mongoose.Schema(
  {
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', required: true },
    period:       { type: String, required: true }, // 'YYYY-MM'
    amount:       { type: Number, required: true }, // amount in `currency`
    currency:     { type: String, default: 'BDT' },
    amountBDT:    { type: Number, default: null },  // BDT-equivalent; == amount for BDT
    status:       { type: String, enum: ['PENDING', 'PAID', 'CANCELLED'], default: 'PENDING' },

    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    approvedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt:    { type: Date, default: null },
    note:          { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

SalaryPayoutSchema.index({ freelancerId: 1, period: 1 }, { unique: true })

if (mongoose.models.SalaryPayout) delete mongoose.models.SalaryPayout
export default mongoose.model('SalaryPayout', SalaryPayoutSchema)
