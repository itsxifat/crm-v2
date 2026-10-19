import mongoose from 'mongoose'
import { dhakaDayStart } from '../lib/dhakaTime'
import {
  MONEY_ACCOUNT_TYPE_VALUES, MFS_PROVIDER_VALUES, WALLET_TYPE_VALUES, MONEY_ACCOUNT_STATUSES,
  CASH_ACCOUNT_TYPES, defaultIsBankingChannel, defaultAllowNegative,
} from '../lib/finance/constants'

/**
 * A real place money sits: bank account, cash box, petty cash, mobile wallet,
 * card, gateway or loan/OD. Every cash-moving Transaction carries accountId.
 * Balance = openingBalance + Σ IN − Σ OUT of rows with date >= openingDate
 * (see lib/finance/ledger.js getAccountBalances).
 */
const MoneyAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Optional short code (unique when set — partial index below).
    code: { type: String, uppercase: true, trim: true, default: undefined },
    type: { type: String, enum: MONEY_ACCOUNT_TYPE_VALUES, required: true },

    bankName:      { type: String, trim: true, default: null },
    branchName:    { type: String, trim: true, default: null },
    routingNumber: { type: String, trim: true, default: null },
    swiftCode:     { type: String, trim: true, uppercase: true, default: null },
    accountName:   { type: String, trim: true, default: null },
    accountNumber: { type: String, trim: true, default: null }, // full; masked in APIs unless pii.financial.view
    last4:         { type: String, default: null },             // derived from accountNumber

    mfsProvider: { type: String, enum: [...MFS_PROVIDER_VALUES, null], default: null },
    walletType:  { type: String, enum: [...WALLET_TYPE_VALUES, null], default: null },

    currency: { type: String, uppercase: true, trim: true, default: 'BDT' },

    openingBalance:   { type: Number, default: 0 },
    openingDate:      { type: Date, default: null }, // balance counts rows dated >= this (null ⇒ all rows)
    openingReference: { type: String, trim: true, default: null },

    isBankingChannel: { type: Boolean, default: null }, // pre('validate'): !CASH/PETTY_CASH
    allowNegative:    { type: Boolean, default: null }, // pre('validate'): BANK_CURRENT/LOAN_OD/CARD
    creditLimit:      { type: Number, default: 0, min: 0 },

    custodianUserId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    linkedPaymentMethods: { type: [String], default: [] }, // crm_config paymentMethods values this account is default for
    isDefault:            { type: Boolean, default: false },

    status: { type: String, enum: MONEY_ACCOUNT_STATUSES, default: 'ACTIVE' },
    color:  { type: String, trim: true, default: null },
    notes:  { type: String, default: null },

    lastReconciledDate:    { type: Date, default: null },
    lastReconciledBalance: { type: Number, default: null },

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

MoneyAccountSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } })
// Active accounts have distinct names, ignoring case (cash boxes have no last4 to tell
// same-named ones apart in pickers). Backstop for the routes' own check, which also
// covers two simultaneous saves. Archived accounts are left out, so a closed account's
// name can be reused; restoring it is checked by PUT /api/finance/accounts/[id].
MoneyAccountSchema.index(
  { name: 1 },
  { name: 'name_active_ci_unique', unique: true, partialFilterExpression: { status: 'ACTIVE' }, collation: { locale: 'en', strength: 2 } },
)
MoneyAccountSchema.index({ status: 1, type: 1 })

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

MoneyAccountSchema.pre('validate', function () {
  // Empty strings → null/undefined so optional fields stay clean.
  for (const f of ['bankName', 'branchName', 'routingNumber', 'swiftCode', 'accountName', 'accountNumber',
    'openingReference', 'color', 'notes']) {
    if (typeof this[f] === 'string' && this[f].trim() === '') this[f] = null
  }
  if (this.code === null || (typeof this.code === 'string' && this.code.trim() === '')) this.code = undefined
  if (this.mfsProvider === '') this.mfsProvider = null
  if (this.walletType === '') this.walletType = null
  if (!this.currency) this.currency = 'BDT'

  // last4 from the full account number (digits preferred, else trailing chars).
  if (this.isNew || this.isModified('accountNumber') || this.last4 == null) {
    const raw = this.accountNumber == null ? '' : String(this.accountNumber)
    if (raw.includes('•')) {
      this.invalidate('accountNumber', 'Account number contains masked characters — re-enter the full number')
    } else {
      const digits = raw.replace(/\D/g, '')
      const compact = raw.replace(/\s+/g, '')
      this.last4 = digits.length >= 4 ? digits.slice(-4) : (compact ? compact.slice(-4) : null)
    }
  }

  // Cash boxes are never a banking channel; others default to true.
  if (CASH_ACCOUNT_TYPES.includes(this.type)) this.isBankingChannel = false
  else if (this.isBankingChannel == null) this.isBankingChannel = defaultIsBankingChannel(this.type)

  if (this.allowNegative == null) this.allowNegative = defaultAllowNegative(this.type)

  if (this.openingBalance == null || !Number.isFinite(Number(this.openingBalance))) this.openingBalance = 0
  this.openingBalance = round2(this.openingBalance)
  if (this.creditLimit == null || !Number.isFinite(Number(this.creditLimit))) this.creditLimit = 0
  this.creditLimit = round2(this.creditLimit)

  // Opening date is a business day: normalise to Dhaka midnight.
  if (this.openingDate && !Number.isNaN(new Date(this.openingDate).getTime())) {
    this.openingDate = dhakaDayStart(this.openingDate)
  }

  if (Array.isArray(this.linkedPaymentMethods)) {
    const seen = new Set()
    this.linkedPaymentMethods = this.linkedPaymentMethods
      .map(v => String(v ?? '').trim().toUpperCase())
      .filter(v => v && !seen.has(v) && seen.add(v))
  }

  // Archived accounts cannot stay the default.
  if (this.status === 'ARCHIVED') this.isDefault = false
})

// Only one default account per currency: saving a default clears the flag on
// the others (best effort, after the save succeeded).
MoneyAccountSchema.post('save', async function (doc) {
  if (!doc.isDefault) return
  try {
    await doc.constructor.updateMany(
      { _id: { $ne: doc._id }, currency: doc.currency, isDefault: true },
      { $set: { isDefault: false } },
    )
  } catch (err) {
    console.error('[MoneyAccount] failed to clear other default accounts', err)
  }
})

if (mongoose.models.MoneyAccount) delete mongoose.models.MoneyAccount
export default mongoose.model('MoneyAccount', MoneyAccountSchema)
