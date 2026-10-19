/**
 * lib/finance/constants.js — PURE shared finance constants & helpers.
 *
 * Safe to import from 'use client' components: no mongoose, no models, no
 * server-only APIs. lib/finance/ledger.js re-exports everything in here, so
 * server code may import these names from either module.
 */

// ── Transaction kinds ─────────────────────────────────────────────────────────
// `type` (INCOME / EXPENSE) is the cash direction; `kind` decides whether the
// row counts in the P&L. Missing kind ⇒ OPERATING (legacy rows).
export const TX_KINDS = [
  'OPERATING', 'NON_CASH', 'TRANSFER', 'CAPITAL', 'DRAWING', 'LOAN',
  'TAX_PAYMENT', 'TAX_REFUND', 'ASSET_PURCHASE', 'ASSET_SALE', 'ADJUSTMENT',
]

/** Kinds that count in the P&L. */
export const PL_KINDS = ['OPERATING', 'NON_CASH']

/** Kinds that move money but never touch the P&L. */
export const NON_PL_KINDS = TX_KINDS.filter(k => !PL_KINDS.includes(k))

export const KIND_LABELS = {
  OPERATING:      'Operating',
  NON_CASH:       'Non-cash',
  TRANSFER:       'Transfer',
  CAPITAL:        'Capital',
  DRAWING:        'Drawing',
  LOAN:           'Loan',
  TAX_PAYMENT:    'Tax payment',
  TAX_REFUND:     'Tax refund',
  ASSET_PURCHASE: 'Asset purchase',
  ASSET_SALE:     'Asset sale',
  ADJUSTMENT:     'Adjustment',
}

export const KIND_OPTIONS = TX_KINDS.map(k => ({ value: k, label: KIND_LABELS[k] }))

// ── Money accounts ────────────────────────────────────────────────────────────
export const MONEY_ACCOUNT_TYPES = [
  { value: 'BANK_CURRENT', label: 'Bank — Current' },
  { value: 'BANK_SAVINGS', label: 'Bank — Savings/SND' },
  { value: 'CASH',         label: 'Cash in hand' },
  { value: 'PETTY_CASH',   label: 'Petty cash' },
  { value: 'MFS',          label: 'Mobile wallet (bKash/Nagad…)' },
  { value: 'CARD',         label: 'Card' },
  { value: 'GATEWAY',      label: 'Payment gateway' },
  { value: 'LOAN_OD',      label: 'Loan / Overdraft' },
  { value: 'OTHER',        label: 'Other' },
]

export const MONEY_ACCOUNT_TYPE_VALUES = MONEY_ACCOUNT_TYPES.map(t => t.value)

export const MONEY_ACCOUNT_TYPE_LABELS = Object.fromEntries(MONEY_ACCOUNT_TYPES.map(t => [t.value, t.label]))

/** Account types that hold physical cash (never a banking channel). */
export const CASH_ACCOUNT_TYPES = ['CASH', 'PETTY_CASH']

/** Account types allowed to run negative by default. */
export const NEGATIVE_BY_DEFAULT_TYPES = ['BANK_CURRENT', 'LOAN_OD', 'CARD']

export const MONEY_ACCOUNT_STATUSES = ['ACTIVE', 'ARCHIVED']

export const MFS_PROVIDERS = [
  { value: 'BKASH',    label: 'bKash' },
  { value: 'NAGAD',    label: 'Nagad' },
  { value: 'ROCKET',   label: 'Rocket (DBBL)' },
  { value: 'UPAY',     label: 'Upay (UCB)' },
  { value: 'TAP',      label: 'Tap (Trust Axiata Pay)' },
  { value: 'MCASH',    label: 'mCash (IBBL)' },
  { value: 'OKWALLET', label: 'OK Wallet (ONE Bank)' },
  { value: 'OTHER',    label: 'Other' },
]

export const MFS_PROVIDER_VALUES = MFS_PROVIDERS.map(p => p.value)

export const MFS_PROVIDER_LABELS = Object.fromEntries(MFS_PROVIDERS.map(p => [p.value, p.label]))

export const WALLET_TYPES = [
  { value: 'MERCHANT', label: 'Merchant' },
  { value: 'PERSONAL', label: 'Personal' },
  { value: 'AGENT',    label: 'Agent' },
]

export const WALLET_TYPE_VALUES = WALLET_TYPES.map(w => w.value)

export const CLEAR_STATUSES = ['UNCLEARED', 'CLEARED', 'RECONCILED']

export const RECONCILIATION_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'UNDONE']

/** Label for a money-account type value (falls back to the raw value). */
export function accountTypeLabel(type) {
  return MONEY_ACCOUNT_TYPE_LABELS[type] ?? (type ? String(type).replace(/_/g, ' ') : '')
}

/**
 * Bucket used for "funds" totals: 'bank' | 'cash' | 'mfs' | 'other'.
 * Loans/overdrafts, cards and gateways are reported under 'other'.
 */
export function accountTypeGroup(type) {
  if (type === 'BANK_CURRENT' || type === 'BANK_SAVINGS') return 'bank'
  if (CASH_ACCOUNT_TYPES.includes(type)) return 'cash'
  if (type === 'MFS') return 'mfs'
  return 'other'
}

/** Default for MoneyAccount.isBankingChannel. */
export function defaultIsBankingChannel(type) {
  return !CASH_ACCOUNT_TYPES.includes(type)
}

/** Default for MoneyAccount.allowNegative. */
export function defaultAllowNegative(type) {
  return NEGATIVE_BY_DEFAULT_TYPES.includes(type)
}

// ── Bangladesh scheduled banks (datalist source; free text is still allowed) ──
// Sources: research report res_banks.md (Bangladesh Bank list, Wikipedia,
// SWIFT directory). The five Islamic banks merged into Sammilito Islami Bank
// (2025-26) are kept as legacy names because old records and cheques use them.
export const BD_BANK_LIST = [
  // State-owned & specialised
  { name: 'Sonali Bank PLC',                         short: 'Sonali',        swift: 'BSONBDDH', group: 'STATE' },
  { name: 'Janata Bank PLC',                         short: 'Janata',        swift: 'JANBBDDH', group: 'STATE' },
  { name: 'Agrani Bank PLC',                         short: 'Agrani',        swift: 'AGBKBDDH', group: 'STATE' },
  { name: 'Rupali Bank PLC',                         short: 'Rupali',        swift: 'RUPBBDDH', group: 'STATE' },
  { name: 'BASIC Bank Limited',                      short: 'BASIC',         swift: 'BKSIBDDH', group: 'STATE' },
  { name: 'Bangladesh Krishi Bank (BKB)',            short: 'BKB',           swift: 'BKBABDDH', group: 'STATE' },
  { name: 'Bangladesh Development Bank PLC (BDBL)',  short: 'BDBL',          swift: null,       group: 'STATE' },
  { name: 'Rajshahi Krishi Unnayan Bank (RAKUB)',    short: 'RAKUB',         swift: null,       group: 'STATE' },
  { name: 'Probashi Kallyan Bank',                   short: 'PKB',           swift: null,       group: 'STATE' },
  // Private, conventional
  { name: 'BRAC Bank PLC',                           short: 'BRAC',          swift: 'BRAKBDDH', group: 'PRIVATE' },
  { name: 'Dutch-Bangla Bank PLC (DBBL)',            short: 'DBBL',          swift: 'DBBLBDDH', group: 'PRIVATE' },
  { name: 'Eastern Bank PLC (EBL)',                  short: 'EBL',           swift: 'EBLDBDDH', group: 'PRIVATE' },
  { name: 'The City Bank PLC',                       short: 'City',          swift: 'CIBLBDDH', group: 'PRIVATE' },
  { name: 'Prime Bank PLC',                          short: 'Prime',         swift: 'PRBLBDDH', group: 'PRIVATE' },
  { name: 'Pubali Bank PLC',                         short: 'Pubali',        swift: 'PUBABDDH', group: 'PRIVATE' },
  { name: 'United Commercial Bank PLC (UCB)',        short: 'UCB',           swift: 'UCBLBDDH', group: 'PRIVATE' },
  { name: 'Mutual Trust Bank PLC (MTB)',             short: 'MTB',           swift: 'MTBLBDDH', group: 'PRIVATE' },
  { name: 'Bank Asia PLC',                           short: 'Bank Asia',     swift: 'BALBBDDH', group: 'PRIVATE' },
  { name: 'Dhaka Bank PLC',                          short: 'Dhaka Bank',    swift: 'DHBLBDDH', group: 'PRIVATE' },
  { name: 'Southeast Bank PLC',                      short: 'Southeast',     swift: 'SEBDBDDH', group: 'PRIVATE' },
  { name: 'AB Bank PLC',                             short: 'AB Bank',       swift: 'ABBLBDDH', group: 'PRIVATE' },
  { name: 'ONE Bank PLC',                            short: 'ONE Bank',      swift: 'ONEBBDDH', group: 'PRIVATE' },
  { name: 'Trust Bank PLC',                          short: 'Trust',         swift: 'TTBLBDDH', group: 'PRIVATE' },
  { name: 'Mercantile Bank PLC',                     short: 'Mercantile',    swift: 'MBLBBDDH', group: 'PRIVATE' },
  { name: 'Jamuna Bank PLC',                         short: 'Jamuna',        swift: 'JAMUBDDH', group: 'PRIVATE' },
  { name: 'IFIC Bank PLC',                           short: 'IFIC',          swift: 'IFICBDDH', group: 'PRIVATE' },
  { name: 'Uttara Bank PLC',                         short: 'Uttara',        swift: 'UTBLBDDH', group: 'PRIVATE' },
  { name: 'NCC Bank PLC',                            short: 'NCC',           swift: 'NCCLBDDH', group: 'PRIVATE' },
  { name: 'The Premier Bank PLC',                    short: 'Premier',       swift: 'PRMRBDDH', group: 'PRIVATE' },
  { name: 'Midland Bank PLC',                        short: 'Midland',       swift: 'MDBLBDDH', group: 'PRIVATE' },
  { name: 'NRB Bank PLC',                            short: 'NRB',           swift: 'NRBDBDDH', group: 'PRIVATE' },
  { name: 'National Bank PLC',                       short: 'NBL',           swift: null,       group: 'PRIVATE' },
  { name: 'Community Bank Bangladesh PLC',           short: 'Community',     swift: null,       group: 'PRIVATE' },
  { name: 'Meghna Bank PLC',                         short: 'Meghna',        swift: null,       group: 'PRIVATE' },
  { name: 'Modhumoti Bank PLC',                      short: 'Modhumoti',     swift: null,       group: 'PRIVATE' },
  { name: 'South Bangla Agriculture and Commerce Bank PLC (SBAC)', short: 'SBAC', swift: null, group: 'PRIVATE' },
  { name: 'Padma Bank PLC',                          short: 'Padma',         swift: null,       group: 'PRIVATE' },
  { name: 'Bengal Commercial Bank PLC',              short: 'Bengal',        swift: null,       group: 'PRIVATE' },
  { name: 'Citizens Bank PLC',                       short: 'Citizens',      swift: null,       group: 'PRIVATE' },
  // Islamic
  { name: 'Islami Bank Bangladesh PLC (IBBL)',       short: 'IBBL',          swift: 'IBBLBDDH', group: 'ISLAMIC' },
  { name: 'Al-Arafah Islami Bank PLC',               short: 'Al-Arafah',     swift: 'ALARBDDH', group: 'ISLAMIC' },
  { name: 'Shahjalal Islami Bank PLC',               short: 'Shahjalal',     swift: 'SJBLBDDH', group: 'ISLAMIC' },
  { name: 'Standard Bank PLC',                       short: 'Standard',      swift: 'SDBLBDDH', group: 'ISLAMIC' },
  { name: 'Sammilito Islami Bank PLC',               short: 'Sammilito',     swift: null,       group: 'ISLAMIC' },
  // Foreign
  { name: 'Standard Chartered Bank',                 short: 'SCB',           swift: 'SCBLBDDX', group: 'FOREIGN' },
  { name: 'HSBC Bangladesh',                         short: 'HSBC',          swift: 'HSBCBDDH', group: 'FOREIGN' },
  { name: 'Citibank N.A.',                           short: 'Citi',          swift: 'CITIBDDX', group: 'FOREIGN' },
  { name: 'State Bank of India',                     short: 'SBI',           swift: null,       group: 'FOREIGN' },
  { name: 'Woori Bank',                              short: 'Woori',         swift: null,       group: 'FOREIGN' },
  { name: 'Commercial Bank of Ceylon PLC',           short: 'CBC',           swift: null,       group: 'FOREIGN' },
  { name: 'Bank Alfalah Limited',                    short: 'Alfalah',       swift: null,       group: 'FOREIGN' },
  { name: 'Habib Bank Limited',                      short: 'HBL',           swift: null,       group: 'FOREIGN' },
  // Legacy (merged into Sammilito Islami Bank) — kept for old records & cheques
  { name: 'EXIM Bank PLC (legacy)',                  short: 'EXIM',          swift: 'EXBKBDDH', group: 'LEGACY', legacy: true },
  { name: 'First Security Islami Bank PLC (legacy)', short: 'FSIBL',         swift: 'FSEBBDDH', group: 'LEGACY', legacy: true },
  { name: 'Social Islami Bank PLC (legacy)',         short: 'SIBL',          swift: 'SOIVBDDH', group: 'LEGACY', legacy: true },
  { name: 'Union Bank PLC (legacy)',                 short: 'Union',         swift: 'UBLDBDDH', group: 'LEGACY', legacy: true },
  { name: 'Global Islami Bank PLC (legacy)',         short: 'Global Islami', swift: 'NGBLBDDH', group: 'LEGACY', legacy: true },
]

/** Bank names (strings) for <datalist>/<select> sources. */
export const BD_BANKS = BD_BANK_LIST.map(b => b.name)

// ── Payment channels ──────────────────────────────────────────────────────────
// bankingForIncomeTax: counts as "bank transfer" under ITA 2023 s.2(72)
//   (crossed cheque, Bangladesh-Bank-approved means, MFS account-to-account, challan).
// bankingForVat: 'yes' | 'no' | 'uncertain' — "banking channel" for VAT s.46
//   (input tax credit on supplies > Tk 1,00,000). MFS is not clearly covered.
export const PAYMENT_CHANNELS = [
  { value: 'CASH',            label: 'Cash',                        bankingForIncomeTax: false, bankingForVat: 'no' },
  { value: 'CHEQUE',          label: 'Cheque (open / bearer)',      bankingForIncomeTax: false, bankingForVat: 'uncertain' },
  { value: 'AC_PAYEE_CHEQUE', label: 'Account-payee (crossed) cheque', bankingForIncomeTax: true, bankingForVat: 'yes' },
  { value: 'PAY_ORDER',       label: 'Pay order / demand draft',    bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'BEFTN',           label: 'BEFTN',                       bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'RTGS',            label: 'RTGS',                        bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'NPSB',            label: 'NPSB (instant transfer)',     bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'BANK_TRANSFER',   label: 'Bank transfer',               bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'MFS',             label: 'Mobile wallet (MFS)',         bankingForIncomeTax: true,  bankingForVat: 'uncertain' },
  { value: 'CARD',            label: 'Card',                        bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'GATEWAY',         label: 'Payment gateway',             bankingForIncomeTax: true,  bankingForVat: 'uncertain' },
  { value: 'CHALLAN',         label: 'Government challan',          bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'INTERNAL',        label: 'Internal transfer',           bankingForIncomeTax: true,  bankingForVat: 'yes' },
  { value: 'OTHER',           label: 'Other',                       bankingForIncomeTax: false, bankingForVat: 'no' },
]

export const PAYMENT_CHANNEL_VALUES = PAYMENT_CHANNELS.map(c => c.value)

export const PAYMENT_CHANNEL_LABELS = Object.fromEntries(PAYMENT_CHANNELS.map(c => [c.value, c.label]))

/** Channels that are never a banking channel. */
const NON_BANKING_CHANNELS = ['CASH', 'CHEQUE', 'OTHER']

// Legacy crm_config paymentMethods values → channel.
const PAYMENT_METHOD_CHANNEL = {
  CASH:          'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CARD:          'CARD',
  CHEQUE:        'CHEQUE',
  BKASH:         'MFS',
  NAGAD:         'MFS',
  ROCKET:        'MFS',
  UPAY:          'MFS',
  TAP:           'MFS',
  MCASH:         'MFS',
  OKWALLET:      'MFS',
  ONLINE:        'GATEWAY',
  OTHER:         'OTHER',
}

/** Channel implied by a money account's type alone. */
function channelFromAccountType(type) {
  if (CASH_ACCOUNT_TYPES.includes(type)) return 'CASH'
  if (type === 'MFS') return 'MFS'
  if (type === 'CARD') return 'CARD'
  if (type === 'GATEWAY') return 'GATEWAY'
  return 'BANK_TRANSFER'
}

/**
 * Map a legacy payment-method code (CASH, BANK_TRANSFER, CARD, CHEQUE, BKASH,
 * NAGAD, ROCKET, ONLINE, OTHER — or a channel code itself) plus the money
 * account to a PAYMENT_CHANNELS value. Unknown/empty methods fall back to the
 * account type (CASH/PETTY_CASH → CASH, MFS → MFS, CARD → CARD,
 * GATEWAY → GATEWAY, else BANK_TRANSFER). Returns null when neither a known
 * method nor an account is given.
 */
export function channelFromPaymentMethod(paymentMethod, account = null) {
  const pm = paymentMethod == null ? '' : String(paymentMethod).trim().toUpperCase()
  if (pm) {
    if (PAYMENT_METHOD_CHANNEL[pm]) return PAYMENT_METHOD_CHANNEL[pm]
    if (PAYMENT_CHANNEL_VALUES.includes(pm)) return pm
  }
  if (account?.type) return channelFromAccountType(account.type)
  return pm ? 'OTHER' : null
}

/**
 * Normalise a free-form channel value to a PAYMENT_CHANNELS value: channel
 * codes pass through, legacy payment-method codes are mapped (BKASH → MFS…),
 * anything else becomes 'OTHER'. Empty ⇒ null.
 */
export function normalizeChannel(channel) {
  if (channel === null || channel === undefined) return null
  const c = String(channel).trim().toUpperCase()
  if (!c) return null
  if (PAYMENT_CHANNEL_VALUES.includes(c)) return c
  return PAYMENT_METHOD_CHANNEL[c] ?? 'OTHER'
}

/**
 * Whether a payment went through a banking channel (ITA s.2(72) reading).
 * True unless the channel is CASH / open CHEQUE / OTHER (or unrecognised), or
 * the account is a cash type (CASH / PETTY_CASH) or explicitly flagged
 * isBankingChannel:false. Legacy payment-method codes are accepted as channel
 * (BKASH → MFS …).
 */
export function isBankingChannel({ channel = null, account = null } = {}) {
  if (account) {
    if (CASH_ACCOUNT_TYPES.includes(account.type)) return false
    if (account.isBankingChannel === false) return false
  }
  const ch = normalizeChannel(channel)
  if (ch) {
    if (NON_BANKING_CHANNELS.includes(ch)) return false
    const def = PAYMENT_CHANNELS.find(c => c.value === ch)
    return def ? def.bankingForIncomeTax : false
  }
  return true
}

// ── P&L helpers ───────────────────────────────────────────────────────────────

/** Mongo filter selecting rows that count in the P&L (legacy rows have no kind). */
export function plFilter() {
  return { $or: [{ kind: { $exists: false } }, { kind: null }, { kind: { $in: PL_KINDS } }] }
}

/** True when the transaction counts in the P&L. */
export function isPl(tx) {
  if (!tx) return false
  return !tx.kind || PL_KINDS.includes(tx.kind)
}

function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * P&L effect of a transaction in BDT (always ≥ 0 by convention; the sign comes
 * from `type`). Non-P&L kinds ⇒ 0. Uses plAmountBDT when set, else amountBDT,
 * else `amount` for BDT rows. Returns null for a foreign-currency row with no
 * BDT figure (callers exclude such rows from BDT totals).
 */
export function plAmountBDT(tx) {
  if (!tx || !isPl(tx)) return 0
  const pl = finiteOrNull(tx.plAmountBDT)
  if (pl !== null) return pl
  const bdt = finiteOrNull(tx.amountBDT)
  if (bdt !== null) return bdt
  if (!tx.currency || tx.currency === 'BDT') return finiteOrNull(tx.amount) ?? 0
  return null
}

/**
 * Magnitude of a transaction in its money account's currency:
 * accountAmount when stored; otherwise (legacy) the amount when currencies
 * match the account, else amountBDT ?? amount.
 */
export function accountAmountOf(tx, account = null) {
  if (!tx) return 0
  const aa = finiteOrNull(tx.accountAmount)
  if (aa !== null) return aa
  const amount = finiteOrNull(tx.amount) ?? 0
  const txCur = tx.currency || 'BDT'
  if (account?.currency && account.currency === txCur) return amount
  return finiteOrNull(tx.amountBDT) ?? amount
}

/** Signed movement on the money account: INCOME ⇒ +, EXPENSE ⇒ −. */
export function signedAccountAmount(tx, account = null) {
  if (!tx) return 0
  const v = accountAmountOf(tx, account)
  return tx.type === 'EXPENSE' ? -v : v
}

/**
 * Amount to store as Transaction.accountAmount (positive, account currency).
 * Same currency ⇒ amount; BDT account with a known amountBDT ⇒ amountBDT;
 * otherwise throws.
 */
export function computeAccountAmount({ account, amount, currency, amountBDT }) {
  const acctCur = account?.currency || 'BDT'
  const txCur   = currency || 'BDT'
  const amt     = Number(amount)
  if (acctCur === txCur) return Number.isFinite(amt) ? amt : 0
  const bdt = finiteOrNull(amountBDT)
  if (acctCur === 'BDT' && bdt !== null) return bdt
  const err = new Error(`Account currency ${acctCur} does not match transaction currency ${txCur}`)
  err.status = 422
  throw err
}
