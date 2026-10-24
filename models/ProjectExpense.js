import mongoose from 'mongoose'
import { nextSequence, counterValue } from '../lib/sequence'

// Tax breakdown of a supplier bill / payment. `amount` on the expense stays the
// GROSS bill (incl. VAT); cash actually paid = netPayable = amount − vds − tds.
const ExpenseTaxSchema = new mongoose.Schema({
  vatAmount:         { type: Number,  default: 0 },      // VAT included in the bill
  vatRate:           { type: Number,  default: null },
  vatCreditable:     { type: Boolean, default: false },  // claim as input tax credit
  treatment:         { type: String,  default: null },   // VAT_TREATMENTS value
  supplierBin:       { type: String,  default: null },
  supplierVatType:   { type: String,  default: null },   // REGISTERED | TURNOVER | UNREGISTERED | FOREIGN
  mushakNo:          { type: String,  default: null },   // supplier's Mushak-6.3 number
  mushakDate:        { type: Date,    default: null },
  vatServiceCode:    { type: String,  default: null },
  vdsRate:           { type: Number,  default: null },
  vdsAmount:         { type: Number,  default: 0 },      // VAT deducted at source by us
  tdsSection:        { type: String,  default: null },
  tdsRate:           { type: Number,  default: null },
  tdsAmount:         { type: Number,  default: 0 },      // income tax deducted at source by us
  tdsBase:           { type: Number,  default: null },   // amount the TDS is computed on when not the bill excl. VAT (salary: gross pay)
  payeeType:         { type: String,  default: null },   // COMPANY | INDIVIDUAL | NON_RESIDENT
  hasPsr:            { type: Boolean, default: null },
  higherRateApplied: { type: Boolean, default: false },
  netPayable:        { type: Number,  default: null },
  taxDeductible:     { type: Boolean, default: true },   // false ⇒ disallowed for income tax (e.g. cash salary/rent)
}, { _id: false })

const ProjectExpenseSchema = new mongoose.Schema(
  {
    // Human-readable id assigned to every expense on creation (EXPYYMM####).
    expenseId:   { type: String, default: null },
    // Optional — null for salary / reimbursement / general (non-project) spend.
    projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    // Where this expense came from — drives payee display & downstream settlement.
    origin:      { type: String, enum: ['PROJECT','FREELANCER','AGENCY','VENDOR','SALARY','REIMBURSEMENT','OTHER'], default: 'OTHER' },
    // Venture IDs are dynamic (configured in Settings → crm_config), so no static enum.
    venture:     { type: String, default: null, trim: true },
    // Business unit the cost belongs to (lib/units.js): 'VENTURE:<id>' | 'PRODUCT:<id>' |
    // 'COMPANY'; copied to the ledger row when paid. null = old expense not yet placed.
    unit:        { type: String, default: null, trim: true },

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
    // REVERSING is transient: a recorded payment being undone (lib/expensePayment
    // reverseExpensePayment) — it ends at PENDING, or back at PAID / AUTHORIZED on failure.
    status:      { type: String, enum: ['PENDING','PAID','AUTHORIZED','REJECTED','REVERSING'], default: 'PENDING' },

    // ── Review / rejection ──
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:      { type: Date,   default: null },
    reviewNote:      { type: String, default: null },
    receiptUrl:      { type: String, default: null },      // legacy
    expenseInvoiceNo:{ type: String, default: null },      // paid-invoice number, assigned when paid (EXVYYMM####)

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
    // share this reference (EXBYYYYMMDDCATEGORY, then …2, …3) and the same signedInvoiceUrl.
    batchInvoiceNo:  { type: String, default: null },

    // Salary payouts flow through this pipeline via a linked SALARY-origin expense.
    salaryPayoutId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SalaryPayout', default: null },
    // Employee payroll (Salary tab) links its generated slip the same way.
    employeeSalarySlipId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalarySlip', default: null },

    // After PAID, synced to Transaction in accounts module
    syncedToAccounts:     { type: Boolean, default: false },
    accountsTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    // ── Money account & tax (Bangladesh VAT / withholding) ──
    accountId:   { type: mongoose.Schema.Types.ObjectId, ref: 'MoneyAccount', default: null }, // paid from
    channel:     { type: String, default: null },   // PAYMENT_CHANNELS value
    tax:         { type: ExpenseTaxSchema, default: undefined },
    // Portion of this expense capitalised as fixed assets (not charged to P&L).
    capitalizedAmountBDT: { type: Number, default: 0 },
    // BDT the payment added to Project.approvedExpenses (the bill excluding
    // creditable input VAT); the reversal takes off exactly this. null ⇒ not paid,
    // or paid before it was recorded (those payments added the gross bill).
    projectCostBDT: { type: Number, default: null },
    purchaseBillId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseBill', default: null },
    taxEntryIds:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxEntry' }],
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

// Next number in a monthly series (`${code}YYMM####`, e.g. EXV26100001, month in
// Asia/Dhaka) for `field` (expenseId / expenseInvoiceNo). Backed by an atomic
// counter, so a delete or two concurrent requests can never reissue an existing
// number. Numbers issued before 2026-10 read EXV-2610-0001: the floor counts both
// shapes, and the old counter key (projectExpense:<field>:EXV-2610-) too.
ProjectExpenseSchema.statics.nextNumber = async function (field, code) {
  const dhaka  = new Date(Date.now() + 6 * 60 * 60 * 1000)
  const yymm   = `${String(dhaka.getUTCFullYear()).slice(-2)}${String(dhaka.getUTCMonth() + 1).padStart(2, '0')}`
  const prefix = `${code}${yymm}`
  const re     = new RegExp(`^${code}-?${yymm}-?(\\d{4,})$`)
  const existing = await this
    .find({ [field]: { $regex: re.source } })
    .select(field).lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(re.exec(String(d[field]))?.[1], 10) || 0), 0)
  const floor = Math.max(maxUsed, await counterValue(`projectExpense:${field}:${code}-${yymm}-`))
  const seq = await nextSequence(`projectExpense:${field}:${prefix}`, floor)
  return `${prefix}${String(seq).padStart(4, '0')}`
}

// Assign a human-readable expense id on creation (EXPYYMM####).
ProjectExpenseSchema.pre('validate', async function () {
  if (this.expenseId) return
  this.expenseId = await this.constructor.nextNumber('expenseId', 'EXP')
})

if (mongoose.models.ProjectExpense) delete mongoose.models.ProjectExpense
export default mongoose.model('ProjectExpense', ProjectExpenseSchema)
