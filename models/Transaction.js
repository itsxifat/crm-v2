import mongoose from 'mongoose'
import { nextSequence, counterValue } from '../lib/sequence'
import { TX_KINDS, CLEAR_STATUSES } from '../lib/finance/constants'

// Cheque instrument details (cheque / account-payee cheque / pay order).
const ChequeSchema = new mongoose.Schema({
  no:   { type: String, trim: true, default: null },
  date: { type: Date, default: null },
  bank: { type: String, trim: true, default: null },
}, { _id: false })

// Tax breakdown of a settlement (BDT). Income: gross settled = cash + VDS + TDS
// withheld by the client. Expense: gross bill incl. VAT, VDS/TDS we withheld.
const TxTaxSchema = new mongoose.Schema({
  grossBDT:           { type: Number, default: null },
  vatBDT:             { type: Number, default: null },
  sdBDT:              { type: Number, default: null },
  vdsBDT:             { type: Number, default: null },
  tdsBDT:             { type: Number, default: null },
  inputVatCreditable: { type: Boolean, default: null },
  taxDeductible:      { type: Boolean, default: true },
}, { _id: false })

const TransactionSchema = new mongoose.Schema(
  {
    txnId:    { type: String, unique: true, sparse: true, default: null },
    type:     { type: String, enum: ['INCOME', 'EXPENSE'], required: true },

    // Content — all encrypted
    category:    { type: String, required: true },
    amount:      { type: mongoose.Schema.Types.Mixed, required: true }, // amount in `currency`
    currency:    { type: String, default: 'BDT' },
    amountBDT:   { type: Number, default: null }, // BDT-equivalent actually spent/received; == amount for BDT
    description: { type: String, required: true },
    reference:   { type: String, default: null },

    projectId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Project',    default: null },
    invoiceId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice',     default: null },
    agencyId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer',  default: null },
    paidToEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee',    default: null },
    paidToName:       { type: String, default: null }, // encrypted
    clientId:         { type: String, default: null },
    vendorId:         { type: String, default: null },
    freelancerId:     { type: String, default: null },
    vendor:           { type: String, default: null }, // encrypted

    paidBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    accountManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    paymentMethod:   { type: String, default: null },
    expenseCategory: { type: String, default: null }, // encrypted — sub-category for EXPENSE
    receiptUrl: { type: String, default: null }, // encrypted
    date:       { type: Date, required: true },

    // ── Money account & ledger semantics (lib/finance/ledger.js) ──
    // type = cash direction (INCOME in / EXPENSE out); kind decides the P&L:
    // only OPERATING / NON_CASH count. Legacy rows have no kind ⇒ OPERATING.
    accountId:        { type: mongoose.Schema.Types.ObjectId, ref: 'MoneyAccount', default: null },
    accountAmount:    { type: Number, default: null },  // positive, in the money account's currency
    kind:             { type: String, enum: TX_KINDS, default: 'OPERATING' },
    plAmountBDT:      { type: Number, default: null },  // P&L effect (>= 0); null ⇒ amountBDT
    transferId:       { type: String, default: null },  // shared by both legs (+ fee row) of a transfer
    counterAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'MoneyAccount', default: null },
    // PAYMENT_CHANNELS value: CASH|CHEQUE|AC_PAYEE_CHEQUE|PAY_ORDER|BEFTN|RTGS|NPSB|
    // BANK_TRANSFER|MFS|CARD|GATEWAY|CHALLAN|INTERNAL|OTHER (normalised by postMoneyEntry)
    channel:          { type: String, uppercase: true, trim: true, default: null },
    cheque:           { type: ChequeSchema, default: null },

    // Bank / wallet reconciliation
    clearStatus:      { type: String, enum: CLEAR_STATUSES, default: 'UNCLEARED' },
    clearedDate:      { type: Date, default: null },
    reconciliationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reconciliation', default: null },

    // Tax & linked records
    tax:              { type: TxTaxSchema, default: undefined },
    taxEntryIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxEntry' }],
    assetId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', default: null },
    purchaseBillId:   { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseBill', default: null },
    reversalOf:       { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    // Money movements (POST /api/finance/movements): the preset that created the row
    // (components/finance/movementKinds MOVEMENT_KIND_VALUES) and an id shared by every
    // row of one movement (a loan instalment's principal + interest), so it is listed
    // and reversed as one. Absent on all other rows (and on movements recorded before
    // these fields existed — those are recognised by kind / category).
    movementKind:     { type: String, default: undefined },
    movementId:       { type: String, default: undefined },

    // Business unit (lib/units.js): 'VENTURE:<id>' | 'PRODUCT:<id>' | 'COMPANY'.
    // A snapshot set by postMoneyEntry (never null on new rows; a reversal copies its
    // original's). null = Unassigned: old rows scripts/backfill-finance-units.js could not place.
    unit:             { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

TransactionSchema.index({ date: 1 })
TransactionSchema.index({ type: 1, date: 1 })
TransactionSchema.index({ accountId: 1, date: 1 })
TransactionSchema.index({ kind: 1, date: 1 })
TransactionSchema.index({ transferId: 1 })
TransactionSchema.index({ invoiceId: 1 })
// Finance reports by venture / product (unit) over a date range.
TransactionSchema.index({ unit: 1, date: 1 })
// Sparse: only movement rows carry a movementId.
TransactionSchema.index({ movementId: 1 }, { sparse: true })
// A row can be reversed at most once: two concurrent reversals of the same row
// collide here (E11000 on reversalOf, mapped to a 409 by lib/finance/ledger.js).
// Partial, so the many rows with reversalOf = null are not indexed.
TransactionSchema.index(
  { reversalOf: 1 },
  { name: 'reversalOf_1_unique', unique: true, partialFilterExpression: { reversalOf: { $type: 'objectId' } } },
)

TransactionSchema.pre('save', async function () {
  if (this.txnId) return
  // Calendar day in the business timezone (Asia/Dhaka, UTC+6, no DST).
  const dhakaNow = new Date(Date.now() + 6 * 60 * 60 * 1000)
  const datePart = dhakaNow.toISOString().slice(0, 10).replace(/-/g, '')
  // TXN202610240001. Ids issued before 2026-10 read TXN-20261024-0001: the floor
  // counts both shapes, and the old counter key (txn:TXN-20261024-) too. Only these
  // generated ids are matched — typed bank / gateway references share the field.
  const prefix   = `TXN${datePart}`
  const re       = new RegExp(`^TXN-?${datePart}-?(\\d{4,})$`)
  // Highest sequence already issued today (NOT a count — a count reissues an
  // existing id once any of today's ids is renamed/removed and collides on the
  // unique index). The atomic counter keeps concurrent saves from colliding.
  const existing = await mongoose.model('Transaction')
    .find({ txnId: { $regex: re.source } })
    .select('txnId').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(re.exec(d.txnId)?.[1], 10) || 0), 0)
  const floor = Math.max(maxUsed, await counterValue(`txn:TXN-${datePart}-`))
  const seq = await nextSequence(`txn:${prefix}`, floor)
  this.txnId = `${prefix}${String(seq).padStart(4, '0')}`
})

if (mongoose.models.Transaction) delete mongoose.models.Transaction
export default mongoose.model('Transaction', TransactionSchema)
