import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'

const ProjectExpenseSchema = new mongoose.Schema(
  {
    // Human-readable id assigned to every expense on creation (EXP-YYMM-####).
    expenseId:   { type: String, default: null },
    // Optional — null for salary / reimbursement / general (non-project) spend.
    projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    // Where this expense came from — drives payee display & downstream settlement.
    origin:      { type: String, enum: ['PROJECT','FREELANCER','AGENCY','VENDOR','SALARY','REIMBURSEMENT','OTHER'], default: 'OTHER' },
    // Venture IDs are dynamic (configured in Settings → crm_config), so no static enum.
    venture:     { type: String, default: null, trim: true },

    title:       { type: String, required: true, trim: true },
    amount:      { type: Number, required: true },        // amount in `currency`
    currency:    { type: String, default: 'BDT' },
    amountBDT:   { type: Number, default: null },         // BDT-equivalent; == amount for BDT
    category:    { type: String, required: true },
    subcategory: { type: String, default: null },
    date:        { type: Date,   required: true },
    notes:       { type: String, default: null },
    invoiceUrl:  { type: String, default: null },          // invoice/receipt/memo uploaded by submitter (optional proof)

    freelancerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', default: null },
    agencyId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer', default: null }, // Agency type freelancer
    vendorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor',     default: null },
    paidToEmployeeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee',   default: null },
    paidToName:        { type: String, default: null }, // free-text for conveyance / other

    // null for system/cron-generated (e.g. salary) expenses.
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Three-stage flow: PENDING → PAID (payment recorded + ledger entry, paid invoice printable)
    // → AUTHORIZED (authorized invoice scan uploaded). REJECTED terminal.
    status:      { type: String, enum: ['PENDING','PAID','AUTHORIZED','REJECTED'], default: 'PENDING' },

    // ── Review / rejection ──
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:      { type: Date,   default: null },
    reviewNote:      { type: String, default: null },
    receiptUrl:      { type: String, default: null },      // legacy
    expenseInvoiceNo:{ type: String, default: null },      // paid-invoice number, assigned when paid (EXV-YYMM-####)

    // ── Paid step (payment recorded, ledger entry created) ──
    paymentProofUrl: { type: String, default: null },      // proof the payment was actually made (optional if a txn id is given)
    paymentTxnId:    { type: String, default: null },      // external payment/transaction reference
    paidBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt:          { type: Date,   default: null },
    paymentMethod:   { type: String, default: null },      // config payment-method value (CASH / BKASH / …)
    paymentNote:     { type: String, default: null },

    // ── Authorized step (signed & sealed invoice scan re-uploaded) ──
    signedInvoiceUrl:{ type: String, default: null },      // scan/photo of the authorized invoice
    authorizedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorizedAt:    { type: Date,   default: null },

    // When paid as part of a combined/authorized invoice, all expenses in the group
    // share this reference (EXB-YYYYMMDD-CATEGORY) and the same signedInvoiceUrl.
    batchInvoiceNo:  { type: String, default: null },

    // Salary payouts flow through this pipeline via a linked SALARY-origin expense.
    salaryPayoutId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SalaryPayout', default: null },
    // Employee payroll (Salary tab) links its generated slip the same way.
    employeeSalarySlipId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalarySlip', default: null },

    // After PAID, synced to Transaction in accounts module
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

// Next number in a monthly series (`${code}-YYMM-####`, month in Asia/Dhaka) for
// `field` (expenseId / expenseInvoiceNo). Backed by an atomic counter, so a
// delete or two concurrent requests can never reissue an existing number.
ProjectExpenseSchema.statics.nextNumber = async function (field, code) {
  const dhaka  = new Date(Date.now() + 6 * 60 * 60 * 1000)
  const yymm   = `${String(dhaka.getUTCFullYear()).slice(-2)}${String(dhaka.getUTCMonth() + 1).padStart(2, '0')}`
  const prefix = `${code}-${yymm}-`
  const existing = await this
    .find({ [field]: { $regex: `^${prefix}[0-9]+$` } })
    .select(field).lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(String(d[field]).slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`projectExpense:${field}:${prefix}`, maxUsed)
  return `${prefix}${String(seq).padStart(4, '0')}`
}

// Assign a human-readable expense id on creation (EXP-YYMM-####).
ProjectExpenseSchema.pre('validate', async function () {
  if (this.expenseId) return
  this.expenseId = await this.constructor.nextNumber('expenseId', 'EXP')
})

if (mongoose.models.ProjectExpense) delete mongoose.models.ProjectExpense
export default mongoose.model('ProjectExpense', ProjectExpenseSchema)
