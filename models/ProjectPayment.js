import mongoose from 'mongoose'

const ProjectPaymentSchema = new mongoose.Schema(
  {
    projectId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project',  default: null },
    invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice',  default: null },
    clientId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Client',   default: null },
    submittedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',     default: null },

    // Cash received, in `currency`. May be 0 for a withholding-only settlement
    // (paymentMethod 'WITHHOLDING') — `required` on a Number accepts 0; no `min`.
    amount:        { type: Number, required: true },
    currency:      { type: String, default: 'BDT' },
    amountBDT:     { type: Number, default: null },     // BDT-equivalent; == amount for BDT
    paymentMethod: { type: String, default: 'BANK_TRANSFER' },
    channel:       { type: String, default: null },     // PAYMENT_CHANNELS value (BEFTN, MFS, CASH…)
    // Money account the cash landed in (required after go-live on confirmation).
    accountId:     { type: mongoose.Schema.Types.ObjectId, ref: 'MoneyAccount', default: null },

    // ── Tax withheld by the client at source (BDT invoices only) ──
    vdsAmount:          { type: Number, default: 0 },
    tdsAmount:          { type: Number, default: 0 },
    tdsSection:         { type: String, default: null },  // TDS section code, e.g. '90-OTHER'
    vdsCertificateNo:   { type: String, default: null },  // Mushak-6.6 number
    vdsCertificateDate: { type: Date,   default: null },
    tdsCertificateNo:   { type: String, default: null },
    tdsCertificateDate: { type: Date,   default: null },
    // amount + vdsAmount + tdsAmount credited to the invoice (null on legacy rows ⇒ amount).
    settledAmount:      { type: Number, default: null },
    taxEntryIds:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxEntry' }],

    paymentDate:   { type: Date, default: Date.now },
    description:   { type: String, default: null },
    notes:         { type: String, default: null },

    // Proof uploaded by client/submitter at submission time
    receiptUrl:    { type: String, default: null },

    // REVERSING is a short-lived claim while a confirmed payment is being reversed
    // (lib/paymentLedger.js reverseClientSettlement); REVERSED = undone in the books.
    status: {
      type:    String,
      enum:    ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'REVERSING', 'REVERSED'],
      default: 'PENDING_CONFIRMATION',
    },

    // Set on confirmation/rejection
    confirmedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt:    { type: Date, default: null },
    rejectionNote:  { type: String, default: null },

    // Transaction created in accounts on confirmation
    transactionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    // Set when a confirmed payment is reversed (wrong amount, account, VDS / TDS or date)
    reversedBy:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reversedAt:            { type: Date, default: null },
    reversalReason:        { type: String, default: null },
    reversalTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
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
