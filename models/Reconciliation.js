import mongoose from 'mongoose'
import { RECONCILIATION_STATUSES } from '../lib/finance/constants'

// A pre-ticked row as it was when the session started: its cleared date, and its
// bank-statement line (type / date / amounts), so discarding the session restores
// the row only while that line is unchanged (an unticked row becomes editable).
const PreTickedRowSchema = new mongoose.Schema({
  txId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true },
  clearedDate:   { type: Date, default: null },
  type:          { type: String, default: null },
  date:          { type: Date, default: null },
  amount:        { type: mongoose.Schema.Types.Mixed, default: null },
  accountAmount: { type: Number, default: null },
  amountBDT:     { type: Number, default: null },
  currency:      { type: String, default: null },
}, { _id: false })

/**
 * A bank / wallet statement reconciliation session for one MoneyAccount.
 * While IN_PROGRESS the user ticks Transactions as cleared; COMPLETED marks
 * them RECONCILED (difference must be 0). At most one IN_PROGRESS session per
 * account (partial unique index).
 */
const ReconciliationSchema = new mongoose.Schema(
  {
    accountId:        { type: mongoose.Schema.Types.ObjectId, ref: 'MoneyAccount', required: true }, // indexed below
    statementDate:    { type: Date, required: true },
    statementBalance: { type: Number, required: true },
    openingBalance:   { type: Number, default: 0 }, // previous completed reconciliation balance or account opening
    clearedBalance:   { type: Number, default: 0 },
    difference:       { type: Number, default: 0 },
    status:           { type: String, enum: RECONCILIATION_STATUSES, default: 'IN_PROGRESS' },
    transactionIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
    // Rows that were already CLEARED (outside any session) when the session was
    // started and were pulled in pre-ticked. Discarding the session puts each back
    // exactly as it was — CLEARED, detached, with its original cleared date — even
    // if it was unticked meanwhile (unless its statement line was edited since).
    // Sessions started before preTickedRows existed only detach the rows still ticked.
    preTickedIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
    preTickedRows:    { type: [PreTickedRowSchema], default: undefined },

    attachmentUrl: { type: String, default: null },
    notes:         { type: String, default: null },

    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    undoneBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    undoneAt:    { type: Date, default: null },
    undoReason:  { type: String, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

ReconciliationSchema.index({ accountId: 1, statementDate: -1 })
// One open session per account.
ReconciliationSchema.index(
  { accountId: 1 },
  { name: 'accountId_1_in_progress', unique: true, partialFilterExpression: { status: 'IN_PROGRESS' } },
)

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

ReconciliationSchema.pre('validate', function () {
  for (const f of ['statementBalance', 'openingBalance', 'clearedBalance', 'difference']) {
    if (this[f] != null && Number.isFinite(Number(this[f]))) this[f] = round2(this[f])
  }
  if (typeof this.attachmentUrl === 'string' && this.attachmentUrl.trim() === '') this.attachmentUrl = null
  if (typeof this.notes === 'string' && this.notes.trim() === '') this.notes = null
})

if (mongoose.models.Reconciliation) delete mongoose.models.Reconciliation
export default mongoose.model('Reconciliation', ReconciliationSchema)
