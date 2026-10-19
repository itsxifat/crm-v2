/**
 * Opening-balance position maths — PURE (safe for 'use client' and API routes).
 *
 * The CRM keeps one cash ledger plus sub-ledgers (money accounts, tax entries,
 * fixed assets, stock, invoices). At go-live each sub-ledger carries an opening
 * figure; the difference between what the business owned and what it owed is
 * the "opening balance equity" — the balancing figure that stands for owners'
 * capital plus profits retained up to the day before go-live.
 */

import { accountTypeGroup } from '@/lib/finance/constants'

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** '1 account' / '3 accounts'. */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Tax entry types that can be entered as opening balances. */
export const OPENING_TAX_TYPES = [
  'VAT_BALANCE_BF', 'INPUT_VAT', 'VDS_RECEIVABLE', 'TDS_RECEIVABLE', 'ADVANCE_TAX', 'TDS_PAYABLE', 'VDS_PAYABLE',
]

/** Buckets used in the tax summary (VAT_BALANCE_BF splits by side). */
export const TAX_BUCKETS = [
  'VAT_CREDIT', 'INPUT_VAT', 'VDS_RECEIVABLE', 'TDS_RECEIVABLE', 'ADVANCE_TAX',
  'VAT_PAYABLE', 'TDS_PAYABLE', 'VDS_PAYABLE',
]

export const TAX_ASSET_BUCKETS = ['VAT_CREDIT', 'INPUT_VAT', 'VDS_RECEIVABLE', 'TDS_RECEIVABLE', 'ADVANCE_TAX']
export const TAX_LIABILITY_BUCKETS = ['VAT_PAYABLE', 'TDS_PAYABLE', 'VDS_PAYABLE']

export const TAX_BUCKET_LABELS = {
  VAT_CREDIT:     'VAT credit carried forward (Mushak-9.1)',
  INPUT_VAT:      'Unclaimed input VAT',
  VDS_RECEIVABLE: 'VDS deducted by clients',
  TDS_RECEIVABLE: 'AIT / TDS deducted by clients',
  ADVANCE_TAX:    'Advance income tax paid',
  VAT_PAYABLE:    'VAT still owed from earlier returns',
  TDS_PAYABLE:    'TDS deducted, not yet deposited',
  VDS_PAYABLE:    'VDS deducted, not yet paid',
}

/** Bucket of one opening tax entry (null when it does not count). */
export function taxBucketOf(entry) {
  if (!entry || entry.status === 'VOID') return null
  switch (entry.entryType) {
    case 'VAT_BALANCE_BF': return entry.balanceSide === 'PAYABLE' ? 'VAT_PAYABLE' : 'VAT_CREDIT'
    case 'INPUT_VAT':      return entry.creditable === false ? null : 'INPUT_VAT'
    case 'VDS_RECEIVABLE':
    case 'TDS_RECEIVABLE':
    case 'ADVANCE_TAX':
    case 'TDS_PAYABLE':
    case 'VDS_PAYABLE':    return entry.entryType
    default:               return null
  }
}

/** Value an opening tax entry contributes (VAT balance b/f includes its SD part). */
export function taxEntryValue(entry) {
  const amount = Number(entry?.amount) || 0
  if (entry?.entryType === 'VAT_BALANCE_BF') return round2(amount + (Number(entry.sdAmount) || 0))
  return round2(amount)
}

/**
 * Totals of ACTIVE opening tax entries per bucket, plus taxAssets / taxPayable.
 * @returns {{ totals: Record<string, number>, counts: Record<string, number>, taxAssets: number, taxPayable: number }}
 */
export function summarizeOpeningTax(entries = []) {
  const totals = Object.fromEntries(TAX_BUCKETS.map(b => [b, 0]))
  const counts = Object.fromEntries(TAX_BUCKETS.map(b => [b, 0]))
  for (const e of entries) {
    const bucket = taxBucketOf(e)
    if (!bucket) continue
    totals[bucket] = round2(totals[bucket] + taxEntryValue(e))
    counts[bucket] += 1
  }
  const taxAssets = round2(TAX_ASSET_BUCKETS.reduce((s, b) => s + totals[b], 0))
  const taxPayable = round2(TAX_LIABILITY_BUCKETS.reduce((s, b) => s + totals[b], 0))
  return { totals, counts, taxAssets, taxPayable }
}

/** Valid exchange rates (currency → BDT per unit) from finance settings `openingFxRates`. */
export function readFxRates(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [cur, rate] of Object.entries(raw)) {
    const code = String(cur).trim().toUpperCase()
    const n = Number(rate)
    if (/^[A-Z]{3}$/.test(code) && code !== 'BDT' && rate !== null && rate !== '' && Number.isFinite(n) && n > 0) out[code] = n
  }
  return out
}

/**
 * BDT value of an account's opening balance. Null when the account is in a
 * foreign currency and no go-live exchange rate is known.
 */
export function accountOpeningBDT(account, fxRates = {}) {
  const bal = Number(account?.openingBalance) || 0
  const cur = String(account?.currency || 'BDT').toUpperCase()
  if (cur === 'BDT') return round2(bal)
  const rate = Number(fxRates?.[cur])
  if (Number.isFinite(rate) && rate > 0) return round2(bal * rate)
  return bal === 0 ? 0 : null
}

/**
 * Opening position statement.
 * @param {object} p
 * @param {Array<{ type, currency, openingBalance }>} p.accounts  money accounts (opening figures)
 * @param {object} p.fxRates      { USD: 121.5 } BDT per unit on go-live
 * @param {object} p.tax          summarizeOpeningTax(...) result
 * @param {object} p.fixedAssets  { bookValue }
 * @param {object} p.stock        { value }
 * @param {object} p.receivables  { amount }
 */
export function computeOpeningPosition({
  accounts = [], fxRates = {}, tax = null, fixedAssets = null, stock = null, receivables = null,
} = {}) {
  const assets = { cash: 0, bank: 0, mfs: 0, otherMoney: 0, receivables: 0, taxAssets: 0, fixedAssets: 0, stock: 0, total: 0 }
  const liabilities = { taxPayable: 0, overdrafts: 0, total: 0 }
  const unconverted = {}

  for (const acc of accounts) {
    const bdt = accountOpeningBDT(acc, fxRates)
    if (bdt === null) {
      const cur = String(acc.currency || '').toUpperCase()
      unconverted[cur] = round2((unconverted[cur] || 0) + (Number(acc.openingBalance) || 0))
      continue
    }
    if (bdt < 0) {
      liabilities.overdrafts = round2(liabilities.overdrafts - bdt)
      continue
    }
    const group = accountTypeGroup(acc.type)
    const key = group === 'other' ? 'otherMoney' : group
    assets[key] = round2(assets[key] + bdt)
  }

  assets.receivables = round2(Number(receivables?.amount) || 0)
  assets.taxAssets   = round2(Number(tax?.taxAssets) || 0)
  assets.fixedAssets = round2(Number(fixedAssets?.bookValue) || 0)
  assets.stock       = round2(Number(stock?.value) || 0)
  assets.total = round2(assets.cash + assets.bank + assets.mfs + assets.otherMoney + assets.receivables +
    assets.taxAssets + assets.fixedAssets + assets.stock)

  liabilities.taxPayable = round2(Number(tax?.taxPayable) || 0)
  liabilities.total = round2(liabilities.taxPayable + liabilities.overdrafts)

  return {
    assets,
    liabilities,
    equity: round2(assets.total - liabilities.total),
    unconverted: Object.entries(unconverted).map(([currency, amount]) => ({ currency, amount })),
  }
}
