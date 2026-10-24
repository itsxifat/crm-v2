import mongoose from 'mongoose'
import { nextSequence, counterValue } from '../lib/sequence'
import { dhakaParts } from '../lib/dhakaTime'

/**
 * Credit note (Mushak-6.7, kind CREDIT — tax goes down) or debit note
 * (Mushak-6.8, kind DEBIT — tax goes up) against an issued invoice.
 * Item values exclude VAT; totalAmount = valueAmount + sdAmount + vatAmount.
 */
const ObjectId = mongoose.Schema.Types.ObjectId

const NoteItemSchema = new mongoose.Schema(
  {
    description: { type: String, default: null, trim: true },
    quantity:    { type: Number, default: 1 },
    value:       { type: Number, default: 0 },   // excluding VAT
    vatRate:     { type: Number, default: 0 },
    vatAmount:   { type: Number, default: 0 },
    sdAmount:    { type: Number, default: 0 },
  },
  { _id: false }
)

const PartySchema = new mongoose.Schema(
  {
    name:    { type: String, default: null, trim: true },
    bin:     { type: String, default: null, trim: true },
    address: { type: String, default: null },
  },
  { _id: false }
)

const CreditNoteSchema = new mongoose.Schema(
  {
    noteNo: { type: String, unique: true, sparse: true },
    kind:   { type: String, enum: ['CREDIT', 'DEBIT'], required: true },

    invoiceId:     { type: ObjectId, ref: 'Invoice', required: true },
    clientId:      { type: ObjectId, ref: 'Client', required: true },
    invoiceNumber: { type: String, default: null },
    invoiceDate:   { type: Date, default: null },

    issuedAt:   { type: Date, required: true },   // date + time of issue
    reason:     { type: String, enum: ['PRICE_REDUCTION', 'DISCOUNT', 'CANCELLED_SUPPLY', 'RETURN', 'RATE_CHANGE', 'ERROR_CORRECTION', 'OTHER'], required: true },
    reasonText: { type: String, default: null },

    items:       { type: [NoteItemSchema], default: [] },
    valueAmount: { type: Number, default: 0 },
    vatAmount:   { type: Number, default: 0 },
    sdAmount:    { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },

    settlement:      { type: String, enum: ['ADJUST_INVOICE', 'REFUND'], default: 'ADJUST_INVOICE' },
    refundAccountId: { type: ObjectId, ref: 'MoneyAccount', default: null },

    seller: { type: PartySchema, default: () => ({}) },
    buyer:  { type: PartySchema, default: () => ({}) },

    status:       { type: String, enum: ['ISSUED', 'CANCELLED'], default: 'ISSUED' },
    cancelReason: { type: String, default: null },
    cancelledAt:  { type: Date, default: null },
    cancelledBy:  { type: ObjectId, ref: 'User', default: null },

    taxEntryId:    { type: ObjectId, ref: 'TaxEntry', default: null },
    transactionId: { type: ObjectId, ref: 'Transaction', default: null },
    createdBy:     { type: ObjectId, ref: 'User', default: null },
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

// Note numbers: CN2610001 / DN2610001 (series + Dhaka YYMM of issue + 3-digit
// serial). Numbers issued before 2026-10 read CN-2610-001.
const NOTE_NO_RE = /^(CN|DN)-?(\d{4})-?(\d{3,})$/

/**
 * The counter a note number was allocated from, so a rolled-back number can be
 * given back (lib/sequence releaseSequence): 'CN2610075' →
 * { key: 'creditnote:CN2610', value: 75 }; an old 'CN-2610-075' → its old key
 * 'creditnote:CN-2610-'. null for anything else.
 */
export function noteNumberCounter(noteNo) {
  const s = String(noteNo ?? '')
  const m = NOTE_NO_RE.exec(s)
  if (!m) return null
  return { key: s.includes('-') ? `creditnote:${m[1]}-${m[2]}-` : `creditnote:${m[1]}${m[2]}`, value: Number(m[3]) }
}

CreditNoteSchema.pre('validate', async function () {
  if (this.noteNo || !this.kind) return
  // Month of issue in the business timezone (Asia/Dhaka); separate CN / DN series.
  const { year, month } = dhakaParts(this.issuedAt ?? new Date())
  const series = this.kind === 'DEBIT' ? 'DN' : 'CN'
  const yymm   = `${pad2(year % 100)}${pad2(month + 1)}`
  const prefix = `${series}${yymm}`
  const re     = new RegExp(`^${series}-?${yymm}-?(\\d{3,})$`)
  // Highest number already issued for this month in either shape (NOT a count —
  // see lib/sequence.js), floored at the old counter key (creditnote:CN-2610-) too.
  const existing = await mongoose.model('CreditNote')
    .find({ noteNo: { $regex: re.source } })
    .select('noteNo').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(re.exec(d.noteNo)?.[1], 10) || 0), 0)
  const floor = Math.max(maxUsed, await counterValue(`creditnote:${series}-${yymm}-`))
  // Key = noteNumberCounter(noteNo).key, which gives a rolled-back number back.
  const seq = await nextSequence(`creditnote:${prefix}`, floor)
  this.noteNo = `${prefix}${String(seq).padStart(3, '0')}`
})

CreditNoteSchema.index({ invoiceId: 1, status: 1 })
CreditNoteSchema.index({ clientId: 1 })
CreditNoteSchema.index({ issuedAt: -1 })

if (mongoose.models.CreditNote) delete mongoose.models.CreditNote
export default mongoose.model('CreditNote', CreditNoteSchema)
