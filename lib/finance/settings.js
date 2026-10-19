/**
 * lib/finance/settings.js — SERVER-ONLY finance settings, company profile and
 * period-lock / go-live guards.
 *
 * Finance settings live in the `Setting` collection under key
 * `finance_settings` (group `finance`) as a JSON string, deep-merged over
 * DEFAULT_FINANCE_SETTINGS on read. A tiny per-process cache (10s TTL) keeps
 * the guards cheap; saveFinanceSettings() invalidates it.
 */

import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { vatTreatmentMeta } from '@/lib/tax/catalog'
import { dayKeyLabel, isDayKey, toInstant } from './fiscal'

export const FINANCE_SETTINGS_KEY   = 'finance_settings'
export const FINANCE_SETTINGS_GROUP = 'finance'

export const DEFAULT_FINANCE_SETTINGS = {
  fiscalYearStartMonth: 7,
  goLiveDate: null,                 // 'YYYY-MM-DD'
  openingLocked: false, openingLockedAt: null, openingLockedBy: null,
  lockedUntil: null,                // 'YYYY-MM-DD' inclusive
  taxLockedUntil: null,             // 'YYYY-MM-DD' inclusive
  openingFxRates: {},               // { USD: 121.5 } BDT per unit on go-live (opening-balance wizard)
  vat: {
    registrationType: 'REGISTERED', // 'REGISTERED' | 'TURNOVER' | 'UNREGISTERED'
    returnFrequency: 'MONTHLY',     // 'MONTHLY' | 'QUARTERLY'
    defaultSalesTreatment: 'STANDARD', // VAT_TREATMENTS key
    defaultSalesRate: 15,
    defaultServiceCode: null,       // e.g. 'S099.10'
    isVdsEntity: true,              // we withhold VAT at source from suppliers
    commissionerateCode: '0010',
  },
  incomeTax: {
    isWithholdingEntity: true,      // we deduct TDS from payees
    corporateRate: 27.5, cashlessRate: 25,
    taxZone: '', taxCircle: '',
    cashRatioThresholdPct: 50, cashDisallowPct: 25,
  },
  inventory: {
    capitalizationThreshold: 10000,
    depreciationConvention: 'PRORATA_DAYS', // 'PRORATA_DAYS' | 'FULL_MONTH'
    tagPrefix: 'EN',
    postDepreciationToLedger: true,
  },
}

const VAT_REGISTRATION_TYPES = ['REGISTERED', 'TURNOVER', 'UNREGISTERED']
const VAT_RETURN_FREQUENCIES = ['MONTHLY', 'QUARTERLY']
const VAT_SALES_TREATMENTS   = ['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE']
const VAT_ZERO_TREATMENTS    = ['ZERO_RATED', 'EXEMPT', 'NONE']
const DEPRECIATION_CONVENTIONS = ['PRORATA_DAYS', 'FULL_MONTH']

// ── utilities ────────────────────────────────────────────────────────────────

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

const clone = (v) => JSON.parse(JSON.stringify(v))

/** Recursive merge: plain objects merge, everything else (incl. null & arrays) replaces; undefined is skipped. */
function deepMerge(base, patch) {
  const out = isPlainObject(base) ? { ...base } : {}
  if (!isPlainObject(patch)) return out
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : (isPlainObject(v) ? deepMerge({}, v) : v)
  }
  return out
}

function validationError(field, message) {
  const err = new Error(message)
  err.status = 422
  err.field  = field
  return err
}

function toBool(field, v) {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 1 || v === '1') return true
  if (v === 'false' || v === 0 || v === '0') return false
  throw validationError(field, `${field} must be true or false`)
}

function toNum(field, v, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v)
  if (!Number.isFinite(n) || n < min || n > max) {
    const range = Number.isFinite(min) && Number.isFinite(max) ? ` between ${min} and ${max}` : (Number.isFinite(min) ? ` of at least ${min}` : '')
    throw validationError(field, `${field} must be a number${range}`)
  }
  return n
}

function toEnum(field, v, values) {
  const s = v == null ? '' : String(v).trim().toUpperCase()
  if (!values.includes(s)) throw validationError(field, `${field} must be one of ${values.join(', ')}`)
  return s
}

function toDayKeyOrNull(field, v) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw validationError(field, `${field} must be a date (YYYY-MM-DD)`)
    return dhakaDayKey(v)
  }
  const s = String(v).trim()
  if (isDayKey(s)) return s
  // tolerate full ISO timestamps (take the Dhaka calendar day)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return dhakaDayKey(d)
  }
  throw validationError(field, `${field} must be a date (YYYY-MM-DD)`)
}

function toStrOrNull(field, v, { max = 200 } = {}) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (s.length > max) throw validationError(field, `${field} is too long (max ${max} characters)`)
  return s === '' ? null : s
}

function toStr(field, v, { max = 200 } = {}) {
  return toStrOrNull(field, v, { max }) ?? ''
}

/**
 * The default sales rate must belong to the default treatment — the same pairing
 * lib/invoiceTotals.js enforces on every invoice line (the treatment picks the
 * Mushak-9.1 note): STANDARD ⇒ 15; REDUCED ⇒ above 0 and below 15;
 * ZERO_RATED / EXEMPT / NONE ⇒ 0. Otherwise every new invoice, which takes these
 * defaults, would fail validation. Returns null when they pair, else the message.
 */
function vatDefaultRateProblem(treatment, rate) {
  if (treatment === 'STANDARD' && rate !== 15) {
    return 'vat.defaultSalesRate must be 15 for standard-rated sales — use REDUCED for a lower rate'
  }
  if (treatment === 'REDUCED' && !(rate > 0 && rate < 15)) {
    return 'vat.defaultSalesRate must be above 0 and below 15 for reduced-rate sales — use STANDARD for 15 or EXEMPT for 0'
  }
  if (VAT_ZERO_TREATMENTS.includes(treatment) && rate !== 0) {
    return `vat.defaultSalesRate must be 0 when the default treatment is ${treatment}`
  }
  return null
}

/**
 * Validate & normalise a fully-merged settings object. Known keys are coerced
 * (e.g. '15' → 15, 'true' → true) and checked; unknown keys are preserved so
 * newer callers can store extra flags without a library change.
 * `repair` (read path only): a stored default rate that does not pair with the
 * stored treatment is replaced by the treatment's catalog rate instead of
 * failing — failing would make materialize() drop the whole vat group.
 */
function normalizeFinanceSettings(s, { repair = false } = {}) {
  const out = deepMerge(DEFAULT_FINANCE_SETTINGS, s)
  // A group stored as a non-object (corrupt data / bad patch) is rejected outright.
  for (const group of ['vat', 'incomeTax', 'inventory']) {
    if (!isPlainObject(out[group])) throw validationError(group, `${group} must be an object`)
  }

  out.fiscalYearStartMonth = Math.trunc(toNum('fiscalYearStartMonth', out.fiscalYearStartMonth, { min: 1, max: 12 }))
  out.goLiveDate     = toDayKeyOrNull('goLiveDate', out.goLiveDate)
  out.lockedUntil    = toDayKeyOrNull('lockedUntil', out.lockedUntil)
  out.taxLockedUntil = toDayKeyOrNull('taxLockedUntil', out.taxLockedUntil)
  out.openingLocked  = toBool('openingLocked', out.openingLocked)
  if (out.openingLockedAt !== null && out.openingLockedAt !== undefined && out.openingLockedAt !== '') {
    const d = toInstant(out.openingLockedAt)
    if (!d) throw validationError('openingLockedAt', 'openingLockedAt must be a date')
    out.openingLockedAt = d.toISOString()
  } else {
    out.openingLockedAt = null
  }
  out.openingLockedBy = out.openingLockedBy == null || out.openingLockedBy === '' ? null : String(out.openingLockedBy)

  // Go-live exchange rates: currency code → positive BDT-per-unit number.
  // A null / '' rate means "cleared" and the key is dropped.
  if (out.openingFxRates === null || out.openingFxRates === undefined) out.openingFxRates = {}
  if (!isPlainObject(out.openingFxRates)) throw validationError('openingFxRates', 'openingFxRates must be an object')
  const fx = {}
  for (const [rawCode, rate] of Object.entries(out.openingFxRates)) {
    const code = String(rawCode).trim().toUpperCase()
    const field = `openingFxRates.${rawCode}`
    if (!/^[A-Z]{3}$/.test(code) || code === 'BDT') throw validationError(field, `${field} must be a 3-letter currency code other than BDT`)
    if (rate === null || rate === undefined || rate === '') continue
    const n = toNum(field, rate, { min: 0 })
    if (!(n > 0)) throw validationError(field, `${field} must be greater than 0`)
    fx[code] = n
  }
  out.openingFxRates = fx

  const vat = out.vat
  vat.registrationType      = toEnum('vat.registrationType', vat.registrationType, VAT_REGISTRATION_TYPES)
  vat.returnFrequency       = toEnum('vat.returnFrequency', vat.returnFrequency, VAT_RETURN_FREQUENCIES)
  vat.defaultSalesTreatment = toEnum('vat.defaultSalesTreatment', vat.defaultSalesTreatment, VAT_SALES_TREATMENTS)
  vat.defaultSalesRate      = toNum('vat.defaultSalesRate', vat.defaultSalesRate, { min: 0, max: 100 })
  const rateProblem = vatDefaultRateProblem(vat.defaultSalesTreatment, vat.defaultSalesRate)
  if (rateProblem) {
    if (!repair) throw validationError('vat.defaultSalesRate', rateProblem)
    const fallback = Number(vatTreatmentMeta(vat.defaultSalesTreatment)?.defaultRate ?? 0)
    console.error(`[financeSettings] ${rateProblem} (stored ${vat.defaultSalesRate}) — using ${fallback}`)
    vat.defaultSalesRate = fallback
  }
  vat.defaultServiceCode    = toStrOrNull('vat.defaultServiceCode', vat.defaultServiceCode, { max: 40 })
  vat.isVdsEntity           = toBool('vat.isVdsEntity', vat.isVdsEntity)
  vat.commissionerateCode   = toStr('vat.commissionerateCode', vat.commissionerateCode, { max: 20 })

  const it = out.incomeTax
  it.isWithholdingEntity   = toBool('incomeTax.isWithholdingEntity', it.isWithholdingEntity)
  it.corporateRate         = toNum('incomeTax.corporateRate', it.corporateRate, { min: 0, max: 100 })
  it.cashlessRate          = toNum('incomeTax.cashlessRate', it.cashlessRate, { min: 0, max: 100 })
  it.taxZone               = toStr('incomeTax.taxZone', it.taxZone, { max: 120 })
  it.taxCircle             = toStr('incomeTax.taxCircle', it.taxCircle, { max: 120 })
  it.cashRatioThresholdPct = toNum('incomeTax.cashRatioThresholdPct', it.cashRatioThresholdPct, { min: 0, max: 100 })
  it.cashDisallowPct       = toNum('incomeTax.cashDisallowPct', it.cashDisallowPct, { min: 0, max: 100 })

  const inv = out.inventory
  inv.capitalizationThreshold  = toNum('inventory.capitalizationThreshold', inv.capitalizationThreshold, { min: 0 })
  inv.depreciationConvention   = toEnum('inventory.depreciationConvention', inv.depreciationConvention, DEPRECIATION_CONVENTIONS)
  inv.tagPrefix                = String(inv.tagPrefix ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{1,6}$/.test(inv.tagPrefix)) throw validationError('inventory.tagPrefix', 'inventory.tagPrefix must be 1–6 letters or digits')
  inv.postDepreciationToLedger = toBool('inventory.postDepreciationToLedger', inv.postDepreciationToLedger)

  return out
}

// ── cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 1000
let _cache   = null
let _cacheAt = 0

/** Drop the cached finance settings so the next read hits the database. */
export function invalidateFinanceSettingsCache() {
  _cache   = null
  _cacheAt = 0
}

function parseStored(value) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : {}
  } catch (err) {
    console.error('[financeSettings] stored finance_settings is not valid JSON — using defaults', err)
    return {}
  }
}

/** Merge stored settings over defaults; if stored data is invalid, fall back field-group-wise to defaults. */
function materialize(stored) {
  try {
    return normalizeFinanceSettings(stored, { repair: true })
  } catch (err) {
    console.error('[financeSettings] stored finance_settings failed validation — invalid values replaced by defaults', err?.message)
    // Drop only the offending key (or group) and retry; finally fall back to defaults.
    const hasOwn = (o, k) => isPlainObject(o) && Object.prototype.hasOwnProperty.call(o, k)
    const [top, sub] = String(err?.field ?? '').split('.')
    if (top && sub && hasOwn(stored, top) && hasOwn(stored[top], sub)) {
      const group = { ...stored[top] }
      delete group[sub]
      return materialize({ ...stored, [top]: group })
    }
    if (top && hasOwn(stored, top)) {
      const rest = { ...stored }
      delete rest[top]
      return materialize(rest)
    }
    return clone(DEFAULT_FINANCE_SETTINGS)
  }
}

/**
 * Current finance settings (deep-merged with defaults). Cached for 10s per
 * process. Returns a fresh copy each call, so callers may mutate it freely.
 */
export async function getFinanceSettings() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return clone(_cache)
  await connectDB()
  const doc = await Setting.findOne({ key: FINANCE_SETTINGS_KEY }).lean()
  const settings = materialize(parseStored(doc?.value))
  _cache   = settings
  _cacheAt = Date.now()
  return clone(settings)
}

/**
 * Deep-merge `patch` onto the current stored settings, validate, upsert and
 * invalidate the cache. Optimistic concurrency: the write only lands if the
 * stored JSON did not change since it was read (retried up to 5 times).
 * Throws an Error with `.status = 422` (and `.field`) on invalid values.
 * @returns {Promise<object>} the merged settings
 */
export async function saveFinanceSettings(patch = {}) {
  if (!isPlainObject(patch)) throw validationError('settings', 'Settings patch must be an object')
  await connectDB()

  for (let attempt = 0; attempt < 5; attempt++) {
    const doc = await Setting.findOne({ key: FINANCE_SETTINGS_KEY }).lean()
    const current = materialize(parseStored(doc?.value))
    const merged  = normalizeFinanceSettings(deepMerge(current, patch))
    const value   = JSON.stringify(merged)

    let applied
    if (doc) {
      const res = await Setting.updateOne(
        { _id: doc._id, value: doc.value },
        { $set: { value, group: FINANCE_SETTINGS_GROUP } },
      )
      applied = res.matchedCount === 1
    } else {
      try {
        const res = await Setting.updateOne(
          { key: FINANCE_SETTINGS_KEY },
          { $setOnInsert: { value, group: FINANCE_SETTINGS_GROUP } },
          { upsert: true },
        )
        applied = res.upsertedCount === 1
      } catch (err) {
        if (err?.code !== 11000) throw err
        applied = false // created concurrently — retry against the stored doc
      }
    }

    if (applied) {
      invalidateFinanceSettingsCache()
      _cache   = merged
      _cacheAt = Date.now()
      return clone(merged)
    }
  }

  const err = new Error('Finance settings were changed by someone else — please retry')
  err.status = 409
  throw err
}

// ── company profile ──────────────────────────────────────────────────────────

const COMPANY_KEYS = {
  company_name:                  'name',
  company_address:               'address',
  company_phone:                 'phone',
  company_email:                 'email',
  company_website:               'website',
  company_bin:                   'bin',
  company_tin:                   'tin',
  company_trade_license:         'tradeLicense',
  company_vat_circle:            'vatCircle',
  company_issue_address:         'issueAddress',
  company_signatory_name:        'signatoryName',
  company_signatory_designation: 'signatoryDesignation',
}

/**
 * Company profile from `Setting` group 'company'. Missing keys are ''.
 * @returns {Promise<{ name, address, phone, email, website, bin, tin, tradeLicense, vatCircle, issueAddress, signatoryName, signatoryDesignation }>}
 */
export async function getCompanyProfile() {
  await connectDB()
  const rows = await Setting.find({ group: 'company' }).select('key value').lean()
  const profile = Object.fromEntries(Object.values(COMPANY_KEYS).map(k => [k, '']))
  for (const row of rows) {
    const field = COMPANY_KEYS[row.key]
    if (field) profile[field] = row.value == null ? '' : String(row.value)
  }
  return profile
}

// ── guards (return null when OK, else a user-facing error string) ────────────

function dayKeyOfDate(date) {
  if (typeof date === 'string' && isDayKey(date.trim())) return date.trim()
  const d = toInstant(date)
  return d ? dhakaDayKey(d) : null
}

/** null, or 'Books are locked up to DD MMM YYYY' when `date` falls on/before settings.lockedUntil. */
export async function assertBooksOpen(date) {
  const key = dayKeyOfDate(date)
  if (!key) return null
  const { lockedUntil } = await getFinanceSettings()
  if (lockedUntil && key <= lockedUntil) return `Books are locked up to ${dayKeyLabel(lockedUntil)}`
  return null
}

/** null, or 'Tax period is locked up to DD MMM YYYY' when `date` falls on/before settings.taxLockedUntil. */
export async function assertTaxOpen(date) {
  const key = dayKeyOfDate(date)
  if (!key) return null
  const { taxLockedUntil } = await getFinanceSettings()
  if (taxLockedUntil && key <= taxLockedUntil) return `Tax period is locked up to ${dayKeyLabel(taxLockedUntil)} (VAT return filed)`
  return null
}

/**
 * null, or 'Select the money account (bank/cash/wallet) for this entry' when
 * a go-live date is set, `date` is on/after it and no accountId is given.
 */
export async function requireAccountIfLive(date, accountId) {
  if (accountId) return null
  const { goLiveDate } = await getFinanceSettings()
  if (!goLiveDate) return null
  const key = dayKeyOfDate(date ?? new Date())
  if (!key || key < goLiveDate) return null
  return 'Select the money account (bank/cash/wallet) for this entry'
}
