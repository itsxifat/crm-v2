import mongoose from 'mongoose'
import { nextSequence } from '../lib/sequence'
import { dhakaParts } from '../lib/dhakaTime'
import {
  PURCHASE_LINE_TYPES, PURCHASE_BILL_STATUSES, PURCHASE_PAYMENT_MODES, PURCHASE_PAYMENT_STATUSES,
  SUPPLIER_VAT_TYPES, round2,
} from '../lib/inventory/constants'

const { Schema } = mongoose
const { ObjectId } = Schema.Types

const LineSchema = new Schema({
  lineType:         { type: String, enum: PURCHASE_LINE_TYPES, required: true },
  categoryId:       { type: ObjectId, ref: 'AssetCategory', default: null },
  stockItemId:      { type: ObjectId, ref: 'StockItem', default: null },
  description:      { type: String, required: true, trim: true },
  brand:            { type: String, default: null },
  model:            { type: String, default: null },
  qty: {
    type: Number, required: true,
    validate: { validator: v => Number.isFinite(v) && v > 0, message: 'Quantity must be greater than 0' },
  },
  unit:             { type: String, default: null },
  unitPrice:        { type: Number, required: true, min: 0 },   // excl. VAT
  vatRate:          { type: Number, default: 0, min: 0, max: 100 },
  vatAmount:        { type: Number, default: 0, min: 0 },
  sdAmount:         { type: Number, default: 0, min: 0 },
  lineTotal:        { type: Number, default: null },            // qty × unitPrice + VAT + SD
  capitalize:       { type: Boolean, default: null },           // null ⇒ category policy + threshold
  serialNumbers:    { type: [String], default: [] },
  locationId:       { type: ObjectId, ref: 'InventoryLocation', default: null },
  assignEmployeeId: { type: ObjectId, ref: 'Employee', default: null },
  warrantyMonths:   { type: Number, default: null, min: 0 },
  assetIds:         [{ type: ObjectId, ref: 'Asset' }],
  stockMovementId:  { type: ObjectId, ref: 'StockMovement', default: null },
}, {
  id: false,
  toJSON: { transform(_, ret) { if (ret._id != null) { ret.id = ret._id.toString(); delete ret._id } return ret } },
})

const TdsSchema = new Schema({
  section: { type: String, default: null },
  rate:    { type: Number, default: null },
  amount:  { type: Number, default: 0, min: 0 },
  // 50% higher rate applied (no PSR shown / not paid through a bank — ITA 2023 s.142).
  higherRateApplied: { type: Boolean, default: false },
}, { _id: false, id: false })

const VdsSchema = new Schema({
  serviceCode: { type: String, default: null },
  rate:        { type: Number, default: null },
  amount:      { type: Number, default: 0, min: 0 },
}, { _id: false, id: false })

const PaymentSchema = new Schema({
  mode:          { type: String, enum: PURCHASE_PAYMENT_MODES, default: 'REQUEST' },
  accountId:     { type: ObjectId, ref: 'MoneyAccount', default: null },
  paymentMethod: { type: String, default: null },
  expenseId:     { type: ObjectId, ref: 'ProjectExpense', default: null },
  transactionId: { type: ObjectId, ref: 'Transaction', default: null },
  status:        { type: String, enum: PURCHASE_PAYMENT_STATUSES, default: 'UNPAID' },
  // Settlement claim: set while one request receives / settles the bill's payment
  // (so two requests cannot both create an expense or pay); stale after 10 minutes.
  lockId:        { type: ObjectId, default: null },
  lockedAt:      { type: Date, default: null },
}, { _id: false, id: false })

const PurchaseBillSchema = new Schema(
  {
    billNo: { type: String, unique: true, sparse: true },            // 'PB-YYMM-####'

    vendorId:        { type: ObjectId, ref: 'Vendor', default: null },
    vendorName:      { type: String, default: null, trim: true },
    supplierBin:     { type: String, default: null, trim: true },
    supplierVatType: { type: String, enum: SUPPLIER_VAT_TYPES, default: 'REGISTERED' },

    supplierInvoiceNo: { type: String, default: null, trim: true },
    mushakNo:          { type: String, default: null, trim: true },   // Mushak-6.3 number
    mushakDate:        { type: Date, default: null },

    billDate: { type: Date, required: true },
    currency: { type: String, default: 'BDT' },

    lines: { type: [LineSchema], default: [] },

    subtotal:   { type: Number, default: null },
    vatTotal:   { type: Number, default: null },
    sdTotal:    { type: Number, default: null },
    otherCosts: { type: Number, default: 0, min: 0 },
    total:      { type: Number, default: null },

    vatCreditable: { type: Boolean, default: false },
    tds: { type: TdsSchema, default: () => ({}) },
    vds: { type: VdsSchema, default: () => ({}) },
    netPayable: { type: Number, default: null },                    // total − TDS − VDS

    payment: { type: PaymentSchema, default: () => ({}) },

    status:      { type: String, enum: PURCHASE_BILL_STATUSES, default: 'DRAFT' },
    receivedAt:  { type: Date, default: null },
    cancelReason: { type: String, default: null, trim: true },
    cancelledAt:  { type: Date, default: null },
    cancelledBy:  { type: ObjectId, ref: 'User', default: null },
    attachments: { type: [String], default: [] },
    notes:       { type: String, default: null },
    createdBy:   { type: ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

PurchaseBillSchema.pre('validate', async function () {
  // Derived totals are filled only when the caller left them empty; the
  // purchases API computes and stores them explicitly.
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  let subtotal = 0, vatTotal = 0, sdTotal = 0
  for (const line of this.lines ?? []) {
    const base = round2(n(line.qty) * n(line.unitPrice))
    if (line.lineTotal == null) line.lineTotal = round2(base + n(line.vatAmount) + n(line.sdAmount))
    subtotal += base
    vatTotal += n(line.vatAmount)
    sdTotal  += n(line.sdAmount)
  }
  if (this.subtotal == null) this.subtotal = round2(subtotal)
  if (this.vatTotal == null) this.vatTotal = round2(vatTotal)
  if (this.sdTotal == null)  this.sdTotal  = round2(sdTotal)
  if (this.total == null)    this.total    = round2(n(this.subtotal) + n(this.vatTotal) + n(this.sdTotal) + n(this.otherCosts))
  if (this.netPayable == null) this.netPayable = round2(n(this.total) - n(this.tds?.amount) - n(this.vds?.amount))

  if (this.billNo) return
  // Month boundaries follow the business timezone (Asia/Dhaka).
  const { year, month } = dhakaParts(new Date())
  const yymm   = `${String(year).slice(-2)}${String(month + 1).padStart(2, '0')}`
  const prefix = `PB-${yymm}-`
  // Highest number already issued for this prefix (NOT a count — see lib/sequence.js).
  const existing = await mongoose.model('PurchaseBill')
    .find({ billNo: { $regex: `^${prefix}[0-9]+$` } })
    .select('billNo').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(d.billNo.slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`purchasebill:${prefix}`, maxUsed)
  this.billNo = `${prefix}${String(seq).padStart(4, '0')}`
})

PurchaseBillSchema.index({ vendorId: 1, billDate: -1 })
PurchaseBillSchema.index({ status: 1, billDate: -1 })
PurchaseBillSchema.index({ 'payment.expenseId': 1 })

if (mongoose.models.PurchaseBill) delete mongoose.models.PurchaseBill
export default mongoose.model('PurchaseBill', PurchaseBillSchema)
