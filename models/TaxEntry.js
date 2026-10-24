import mongoose from 'mongoose'
import { nextSequence, counterValue } from '../lib/sequence'
import { dhakaParts } from '../lib/dhakaTime'
import { challanKeyOf } from '../lib/tax/challanKey'

/**
 * Tax sub-ledger: one row per tax event (output/input VAT, VDS/TDS receivable &
 * payable, credit/debit notes, deposits, advance tax, adjustments, opening
 * balances). The VAT return (Mushak-9.1), registers (6.1/6.2/6.10), certificates
 * and the withholding return are all computed from these rows.
 *
 * Amounts are BDT. `amount` is always >= 0; the entryType gives the direction.
 * Rows are never deleted — they are voided (status VOID) with a reason.
 */

const ENTRY_TYPES = [
  'OUTPUT_VAT', 'INPUT_VAT', 'VDS_RECEIVABLE', 'VDS_PAYABLE', 'TDS_RECEIVABLE', 'TDS_PAYABLE',
  'CREDIT_NOTE', 'DEBIT_NOTE', 'VAT_PAYMENT', 'TDS_DEPOSIT', 'ADVANCE_TAX', 'VAT_ADJUSTMENT', 'VAT_BALANCE_BF',
]

const ObjectId = mongoose.Schema.Types.ObjectId

const CertificateSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['NOT_REQUIRED', 'PENDING', 'RECEIVED', 'ISSUED'], default: 'NOT_REQUIRED' },
    number: { type: String, default: null, trim: true },
    date:   { type: Date, default: null },
    url:    { type: String, default: null },
  },
  { _id: false }
)

// One challan's share of a TDS / VDS payable (several challans may pay one deduction).
const DepositAllocationSchema = new mongoose.Schema(
  {
    depositEntryId: { type: ObjectId, ref: 'TaxEntry', default: null },
    challanNo:      { type: String, default: null, trim: true },
    date:           { type: Date, default: null },
    accountCode:    { type: String, default: null, trim: true },
    amount:         { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

const DepositSchema = new mongoose.Schema(
  {
    status:         { type: String, enum: ['NOT_REQUIRED', 'PENDING', 'DEPOSITED', 'VIA_RETURN'], default: 'NOT_REQUIRED' },
    challanNo:      { type: String, default: null, trim: true },   // the challan that completed the deposit
    date:           { type: Date, default: null },
    depositEntryId: { type: ObjectId, ref: 'TaxEntry', default: null },
    accountCode:    { type: String, default: null, trim: true },
    // Part payments: paidAmount = sum of allocations; the payable stays PENDING
    // until it reaches `amount`, then turns DEPOSITED. Rows deposited in full
    // before part payments existed have no allocations (paidAmount 0).
    paidAmount:     { type: Number, default: 0, min: 0 },
    allocations:    { type: [DepositAllocationSchema], default: [] },
  },
  { _id: false }
)

// Deposit rows: how much of the challan went to each payable it settles.
const SettledAllocationSchema = new mongoose.Schema(
  {
    entryId: { type: ObjectId, ref: 'TaxEntry', required: true },
    amount:  { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

const ChallanSchema = new mongoose.Schema(
  {
    bank:        { type: String, default: null, trim: true },
    branch:      { type: String, default: null, trim: true },
    accountCode: { type: String, default: null, trim: true },
  },
  { _id: false }
)

const TaxEntrySchema = new mongoose.Schema(
  {
    entryNo:   { type: String, unique: true, sparse: true },
    entryType: { type: String, enum: ENTRY_TYPES, required: true },
    isOpening: { type: Boolean, default: false },

    status:     { type: String, enum: ['ACTIVE', 'VOID'], default: 'ACTIVE' },
    voidReason: { type: String, default: null },
    voidedBy:   { type: ObjectId, ref: 'User', default: null },
    voidedAt:   { type: Date, default: null },

    date:       { type: Date, required: true },                                     // tax point / document date
    period:     { type: String, required: true, match: /^\d{4}-\d{2}$/ },         // 'YYYY-MM' (Dhaka)
    fiscalYear: { type: String, required: true },                                   // '2026-27'

    baseAmount: { type: Number, default: 0 },                // taxable value / payment base (BDT)
    rate:       { type: Number, default: null },             // % applied
    amount:     { type: Number, required: true, min: 0 },    // tax amount (BDT)
    sdRate:     { type: Number, default: 0 },
    sdAmount:   { type: Number, default: 0, min: 0 },

    treatment:       { type: String, default: null },        // VAT_TREATMENTS value
    serviceCode:     { type: String, default: null },
    creditable:      { type: Boolean, default: null },       // INPUT_VAT
    nonCreditReason: { type: String, default: null },        // INPUT_NON_CREDIT_REASONS key
    claimPeriod:     { type: String, default: null },        // 'YYYY-MM' — set when included in a FILED return
    claimDeadline:   { type: String, default: null },        // last 'YYYY-MM' the credit may be claimed

    adjustmentDirection: { type: String, enum: ['INCREASE', 'DECREASE', null], default: null },
    adjustmentNote:      { type: Number, default: null },    // 9.1 note: 25|27|41|43|44 INCREASE; 32 DECREASE
    balanceSide:         { type: String, enum: ['CREDIT', 'PAYABLE', null], default: null }, // VAT_BALANCE_BF

    section:           { type: String, default: null },      // TDS section code e.g. '90-OTHER'
    payeeType:         { type: String, enum: ['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT', null], default: null },
    higherRateApplied: { type: Boolean, default: false },
    higherRateReason:  { type: String, default: null },

    partyType:    { type: String, enum: ['CLIENT', 'VENDOR', 'FREELANCER', 'AGENCY', 'EMPLOYEE', 'OTHER', null], default: null },
    partyId:      { type: String, default: null },
    partyName:    { type: String, default: null, trim: true },
    partyBin:     { type: String, default: null, trim: true },
    partyTin:     { type: String, default: null, trim: true },
    partyAddress: { type: String, default: null },

    documentNo:   { type: String, default: null, trim: true }, // invoice no / supplier challan / bill no / note no
    documentDate: { type: Date, default: null },

    certificate: { type: CertificateSchema, default: () => ({}) },
    deposit:     { type: DepositSchema, default: () => ({}) },

    bankingChannel: { type: Boolean, default: null },

    invoiceId:        { type: ObjectId, ref: 'Invoice',        default: null },
    creditNoteId:     { type: ObjectId, ref: 'CreditNote',     default: null },
    projectPaymentId: { type: ObjectId, ref: 'ProjectPayment', default: null },
    expenseId:        { type: ObjectId, ref: 'ProjectExpense', default: null },
    transactionId:    { type: ObjectId, ref: 'Transaction',    default: null },
    purchaseBillId:   { type: ObjectId, ref: 'PurchaseBill',   default: null },
    assetId:          { type: ObjectId, ref: 'Asset',          default: null },
    filingId:         { type: ObjectId, ref: 'TaxFiling',      default: null },

    settledEntryIds:    [{ type: ObjectId, ref: 'TaxEntry' }],   // deposits: which payables they settle (in full or in part)
    settledAllocations: { type: [SettledAllocationSchema], default: undefined }, // deposits: share per payable
    challan:            { type: ChallanSchema, default: undefined },
    // Deposit rows (TDS_DEPOSIT / VAT_PAYMENT / ADVANCE_TAX): normalised deposit.challanNo
    // (lib/tax/challanKey.js) — one ACTIVE row per challan and type (unique index below).
    challanKey:         { type: String, default: null },
    instalment:         { type: Number, min: 1, max: 4, default: null }, // ADVANCE_TAX: s.155 instalment paid (1–4)

    notes:       { type: String, default: null },
    attachments: { type: [String], default: [] },
    createdBy:   { type: ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

const pad2 = (n) => String(n).padStart(2, '0')
const CHALLAN_KEYED_TYPES = ['TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX']

// Entry numbers: TAX261000001 (TAX + Dhaka YYMM of creation + 5-digit serial).
// Numbers issued before 2026-10 read TAX-2610-00001.
const ENTRY_NO_RE = /^TAX-?(\d{4})-?(\d{5,})$/

/**
 * The counter an entry number was allocated from, so a rolled-back number can be
 * given back (lib/sequence releaseSequence): 'TAX261000075' →
 * { key: 'taxentry:TAX2610', value: 75 }; an old 'TAX-2610-00075' → its old key
 * 'taxentry:TAX-2610-'. null for anything else.
 */
export function entryNumberCounter(entryNo) {
  const s = String(entryNo ?? '')
  const m = ENTRY_NO_RE.exec(s)
  if (!m) return null
  return { key: s.includes('-') ? `taxentry:TAX-${m[1]}-` : `taxentry:TAX${m[1]}`, value: Number(m[2]) }
}

TaxEntrySchema.pre('validate', async function () {
  // period / fiscalYear fallback (recordTaxEntry normally fills these using the
  // configured fiscal-year start month; this keeps direct creates valid).
  if (this.date && !Number.isNaN(new Date(this.date).getTime()) && (!this.period || !this.fiscalYear)) {
    const { year, month } = dhakaParts(this.date)
    if (!this.period) this.period = `${year}-${pad2(month + 1)}`
    if (!this.fiscalYear) {
      const startYear = month + 1 >= 7 ? year : year - 1
      this.fiscalYear = `${startYear}-${pad2((startYear + 1) % 100)}`
    }
  }

  // Challan key of a deposit row — from deposit.challanNo only (settled payables
  // also carry the challan number but must never take part in the unique index).
  if (CHALLAN_KEYED_TYPES.includes(this.entryType)) {
    this.challanKey = this.isOpening ? null : challanKeyOf(this.deposit?.challanNo)
  }

  if (this.entryNo) return
  // Number prefix follows the business timezone (Asia/Dhaka) month of creation.
  const { year, month } = dhakaParts(this.createdAt ?? new Date())
  const yymm   = `${pad2(year % 100)}${pad2(month + 1)}`
  const prefix = `TAX${yymm}`
  const re     = new RegExp(`^TAX-?${yymm}-?(\\d{5,})$`)
  // Highest number already issued for this month in either shape (NOT a count — a
  // count reissues an existing number after any delete and collides on the unique
  // index), floored at the old counter key (taxentry:TAX-2610-) as well.
  const existing = await mongoose.model('TaxEntry')
    .find({ entryNo: { $regex: re.source } })
    .select('entryNo').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(re.exec(d.entryNo)?.[1], 10) || 0), 0)
  const floor = Math.max(maxUsed, await counterValue(`taxentry:TAX-${yymm}-`))
  // Key = entryNumberCounter(entryNo).key, which gives a rolled-back number back.
  const seq = await nextSequence(`taxentry:${prefix}`, floor)
  this.entryNo = `${prefix}${String(seq).padStart(5, '0')}`
})

TaxEntrySchema.index({ entryType: 1, period: 1 })
TaxEntrySchema.index({ fiscalYear: 1, entryType: 1 })
TaxEntrySchema.index({ invoiceId: 1 })
TaxEntrySchema.index({ expenseId: 1 })
TaxEntrySchema.index({ projectPaymentId: 1 })
TaxEntrySchema.index({ transactionId: 1 })
TaxEntrySchema.index({ filingId: 1 })
TaxEntrySchema.index({ date: 1 })
TaxEntrySchema.index({ 'certificate.status': 1 })
TaxEntrySchema.index({ 'deposit.status': 1 })
// One live OUTPUT_VAT per invoice. invoiceId must be a real ObjectId to be
// indexed, so manual / asset-sale OUTPUT_VAT rows (invoiceId null) never collide.
TaxEntrySchema.index(
  { invoiceId: 1, entryType: 1 },
  {
    unique: true,
    name: 'uniq_invoice_output_vat',
    partialFilterExpression: { entryType: 'OUTPUT_VAT', status: 'ACTIVE', isOpening: false, invoiceId: { $type: 'objectId' } },
  }
)
// One live deposit per treasury challan and type. Voiding (status VOID) frees the
// number; rows without a key (opening balances, legacy rows not yet backfilled by
// scripts/migrate-tax-challan-keys.js) are not indexed.
TaxEntrySchema.index(
  { entryType: 1, challanKey: 1 },
  {
    unique: true,
    name: 'uniq_active_deposit_challan',
    partialFilterExpression: { status: 'ACTIVE', challanKey: { $type: 'string' } },
  }
)
// One live opening VAT balance brought forward per side (CREDIT / PAYABLE) — the
// first VAT return adds every ACTIVE b/f line (note 52), so a double submit would
// count twice. Voiding drops the row from the index, so the side can be re-entered.
TaxEntrySchema.index(
  { entryType: 1, balanceSide: 1 },
  {
    unique: true,
    name: 'uniq_opening_vat_bf_side',
    partialFilterExpression: { entryType: 'VAT_BALANCE_BF', status: 'ACTIVE', isOpening: true },
  }
)

if (mongoose.models.TaxEntry) delete mongoose.models.TaxEntry
export default mongoose.model('TaxEntry', TaxEntrySchema)
