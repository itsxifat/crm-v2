/**
 * lib/tax/engine.js — SERVER-ONLY tax engine.
 *
 * Tax codes (effective-dated master data), TDS / VDS suggestions, the tax
 * sub-ledger writer (recordTaxEntry / voidTaxEntry), the compliance calendar
 * and the cash-payment ratio used for the income-tax cash rules.
 *
 * Errors meant for API callers are thrown as Error with `.status` (404/409/422);
 * routes map them to `{ error: err.message }` with that status.
 *
 * Never import this from a 'use client' component — use lib/tax/catalog.js.
 */

import mongoose from 'mongoose'
import { TaxEntry, TaxCode, TaxFiling, Transaction, MoneyAccount } from '@/models'
import { getFinanceSettings, assertBooksOpen, assertTaxOpen } from '@/lib/finance/settings'
import {
  toInstant, fiscalYearOf, fiscalYearRange, taxPeriodOf, addPeriods, periodsBetween, periodLabel,
  periodLastDay, vatReturnPeriodFor, whtQuarterOf, tdsDepositDueDate, advanceTaxDueDates,
} from '@/lib/finance/fiscal'
import { dhakaDayKey, dhakaDayStart, dhakaDate, dhakaParts, parseDhakaDay } from '@/lib/dhakaTime'
import {
  round2, vatFromInclusive, inputVatCreditability, vatReturnNoteOf, calcTds, calcVds,
  VAT_SERVICE_CODES, TDS_SECTIONS, TAX_ENTRY_TYPES, CLAIM_WINDOW_PERIODS,
  catalogTdsSection, catalogVatServiceCode, pickEffectiveVersion, isVatEntryType, vatReturnOverrideFor,
} from '@/lib/tax/catalog'

// Re-exported so server code can import every tax helper from one place.
export { round2, vatFromInclusive, inputVatCreditability, vatReturnNoteOf }

const DAY_MS = 24 * 60 * 60 * 1000
const TAX_CODE_KINDS = ['VAT_SERVICE', 'TDS_SECTION']

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** Date | 'YYYY-MM-DD' | ISO → Date (falls back to now for empty/invalid input). */
function toDate(value) {
  if (value === null || value === undefined || value === '') return new Date()
  return toInstant(value) ?? new Date()
}

/** 'YYYY-MM-DD' (catalog) → Dhaka-midnight Date. */
function dayToDate(day) {
  if (!day) return null
  if (day instanceof Date) return day
  return parseDhakaDay(String(day))?.start ?? null
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

// ─── Tax codes ────────────────────────────────────────────────────────────────

function catalogRowsForSeed() {
  const vat = VAT_SERVICE_CODES.map((r, i) => ({
    kind:          'VAT_SERVICE',
    code:          r.code,
    label:         r.label,
    description:   r.description ?? null,
    vatRate:       r.vatRate,
    vdsRate:       r.vdsRate,
    treatment:     r.treatment ?? null,
    basis:         'GROSS',
    effectiveFrom: dayToDate(r.effectiveFrom),
    effectiveTo:   dayToDate(r.effectiveTo),
    isActive:      true,
    isSystem:      true,
    sortOrder:     i * 10,
    notes:         r.source ?? null,
  }))
  const order = []
  for (const r of TDS_SECTIONS) if (!order.includes(r.code)) order.push(r.code)
  const tds = TDS_SECTIONS.map((r) => ({
    kind:           'TDS_SECTION',
    code:           r.code,
    label:          r.label,
    description:    r.note || null,
    section:        r.section,
    rateCompany:    r.rateCompany,
    rateIndividual: r.rateIndividual,
    basis:          r.basis ?? 'GROSS',
    commissionRate: r.commissionRate ?? null,
    grossRate:      r.grossRate ?? null,
    effectiveFrom:  dayToDate(r.effectiveFrom),
    effectiveTo:    dayToDate(r.effectiveTo),
    isActive:       true,
    isSystem:       true,
    sortOrder:      order.indexOf(r.code) * 10,
    notes:          r.source ?? null,
  }))
  return [...vat, ...tds]
}

let seedPromise = null

/**
 * Seeds the catalog codes into TaxCode (isSystem: true). Rows are matched on
 * (kind, code, effectiveFrom) and only inserted when missing ($setOnInsert), so
 * an empty collection gets the whole catalog, edits made by admins are never
 * overwritten, and catalog versions added later are picked up. Runs once per process.
 */
export async function ensureTaxCodesSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const ops = catalogRowsForSeed().map(row => ({
        updateOne: {
          filter: { kind: row.kind, code: row.code, effectiveFrom: row.effectiveFrom },
          update: { $setOnInsert: row },
          upsert: true,
        },
      }))
      try {
        // Make sure the unique (kind, code, effectiveFrom) index exists before upserting.
        await TaxCode.init()
        await TaxCode.bulkWrite(ops, { ordered: false })
      } catch (err) {
        // Concurrent seeding races on the unique index — the rows exist, which is all we need.
        const dupOnly = err?.code === 11000 || (Array.isArray(err?.writeErrors) && err.writeErrors.length > 0 && err.writeErrors.every(e => (e.code ?? e.err?.code) === 11000))
        if (!dupOnly) throw err
      }
      return true
    })().catch(err => {
      seedPromise = null
      throw err
    })
  }
  return seedPromise
}

/** Lean TaxCode → API shape (id + Dhaka day keys for the effective range). */
export function normalizeTaxCode(doc) {
  if (!doc) return null
  const { _id, __v, ...rest } = doc
  return {
    ...rest,
    id:               _id ? _id.toString() : (doc.id ?? null),
    effectiveFromDay: rest.effectiveFrom ? dhakaDayKey(rest.effectiveFrom) : null,
    effectiveToDay:   rest.effectiveTo ? dhakaDayKey(rest.effectiveTo) : null,
  }
}

/** Catalog row → the same shape as normalizeTaxCode (id null, source 'catalog'). */
function catalogAsCode(row, kind) {
  if (!row) return null
  const base = {
    id:               null,
    kind,
    code:             row.code,
    label:            row.label,
    description:      (kind === 'TDS_SECTION' ? row.note : row.description) || null,
    effectiveFrom:    dayToDate(row.effectiveFrom),
    effectiveTo:      dayToDate(row.effectiveTo),
    effectiveFromDay: row.effectiveFrom ?? null,
    effectiveToDay:   row.effectiveTo ?? null,
    isActive:         true,
    isSystem:         true,
    notes:            row.source ?? null,
    source:           'catalog',
    ...(row.effectiveNote ? { effectiveNote: row.effectiveNote } : {}),
  }
  if (kind === 'TDS_SECTION') {
    return {
      ...base,
      section:        row.section,
      rateCompany:    row.rateCompany,
      rateIndividual: row.rateIndividual,
      basis:          row.basis ?? 'GROSS',
      commissionRate: row.commissionRate ?? null,
      grossRate:      row.grossRate ?? null,
    }
  }
  return { ...base, vatRate: row.vatRate, vdsRate: row.vdsRate, treatment: row.treatment ?? null }
}

/**
 * Tax codes of a kind (or both kinds when `kind` is falsy).
 *   - default: one row per code — the version effective on `asOf` (latest effectiveFrom wins), active only.
 *   - includeInactive: also deactivated codes.
 *   - allVersions: every stored version regardless of dates (for the settings table).
 * Sorted by sortOrder, code.
 */
export async function getTaxCodes(kind, { asOf = new Date(), includeInactive = false, allVersions = false } = {}) {
  if (kind && !TAX_CODE_KINDS.includes(kind)) throw httpError(422, `Unknown tax code kind ${kind}`)
  await ensureTaxCodesSeeded()

  const filter = {}
  if (kind) filter.kind = kind
  if (!includeInactive) filter.isActive = true
  if (!allVersions) {
    const at = toDate(asOf)
    filter.effectiveFrom = { $lte: at }
    filter.$or = [{ effectiveTo: null }, { effectiveTo: { $gte: dhakaDayStart(at) } }]
  }

  const docs = await TaxCode.find(filter).sort({ sortOrder: 1, code: 1, effectiveFrom: -1 }).lean()
  const rows = docs.map(normalizeTaxCode)
  if (allVersions) return rows

  // One version per (kind, code): active first, then the latest effectiveFrom.
  const best = new Map()
  for (const r of rows) {
    const k = `${r.kind}:${r.code}`
    const cur = best.get(k)
    if (!cur) { best.set(k, r); continue }
    const better = (r.isActive && !cur.isActive) ||
      (r.isActive === cur.isActive && new Date(r.effectiveFrom) > new Date(cur.effectiveFrom))
    if (better) best.set(k, r)
  }
  const kindOrder = (k) => TAX_CODE_KINDS.indexOf(k)
  return [...best.values()].sort((a, b) =>
    kindOrder(a.kind) - kindOrder(b.kind) ||
    (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
    String(a.code).localeCompare(String(b.code)))
}

async function getCodeVersion(kind, code, asOf) {
  const c = String(code ?? '').trim().toUpperCase()
  if (!c) return null
  const at = toDate(asOf)
  await ensureTaxCodesSeeded()
  const docs = await TaxCode.find({ kind, code: c }).lean()
  if (docs.length) {
    const rows = docs.map(normalizeTaxCode)
    return pickEffectiveVersion(rows, at)
  }
  const fromCatalog = kind === 'TDS_SECTION' ? catalogTdsSection(c, at) : catalogVatServiceCode(c, at)
  return catalogAsCode(fromCatalog, kind)
}

/** The TDS section version effective on `asOf` (stored TaxCode, else catalog). Null when unknown. */
export async function getTdsSection(code, asOf = new Date()) {
  return getCodeVersion('TDS_SECTION', code, asOf)
}

/**
 * Batched getTdsSection for reports: one query for every code, then a sync
 * resolver (code, date) → the TDS section version effective on that date
 * (stored TaxCode — custom codes and admin edits — first, else the catalog), or null.
 */
export async function tdsSectionResolver(codes) {
  const list = [...new Set((codes ?? []).filter(Boolean).map(c => String(c).trim().toUpperCase()).filter(Boolean))]
  await ensureTaxCodesSeeded()
  const docs = list.length ? await TaxCode.find({ kind: 'TDS_SECTION', code: { $in: list } }).lean() : []
  const byCode = new Map()
  for (const d of docs) {
    const r = normalizeTaxCode(d)
    if (!byCode.has(r.code)) byCode.set(r.code, [])
    byCode.get(r.code).push(r)
  }
  return (code, date = new Date()) => {
    const c = String(code ?? '').trim().toUpperCase()
    if (!c) return null
    const at = toDate(date)
    const rows = byCode.get(c)
    return rows?.length ? pickEffectiveVersion(rows, at) : catalogAsCode(catalogTdsSection(c, at), 'TDS_SECTION')
  }
}

/** The VAT service code version effective on `asOf` (stored TaxCode, else catalog). Null when unknown. */
export async function getVatServiceCode(code, asOf = new Date()) {
  return getCodeVersion('VAT_SERVICE', code, asOf)
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

/**
 * Income-tax withholding suggestion for a payment.
 * perspective 'PAYEE' = we deduct from a supplier (zero when the company is not a
 * withholding entity); 'CUSTOMER' = a client deducted from us (no entity check).
 * @returns {Promise<{ sectionCode, section, label, basis, appliedBasis, payeeType, baseAmount, commissionAmount,
 *   baseRate, rate, amount, higherRateApplied, higherRateReason, reasons: string[], effectiveFrom }>}
 */
export async function suggestTds({
  sectionCode,
  payeeType = 'COMPANY',
  baseAmount,
  commissionAmount = null,
  hasPsr = true,
  bankingChannel = true,
  date = new Date(),
  perspective = 'PAYEE',
} = {}) {
  if (!sectionCode) throw httpError(422, 'Select a TDS section')
  const row = await getTdsSection(sectionCode, date)
  if (!row) throw httpError(422, `Unknown TDS section ${sectionCode}`)

  const result = calcTds(row, { payeeType, baseAmount, commissionAmount, hasPsr, bankingChannel })
  result.effectiveFrom = row.effectiveFromDay ?? null
  if (row.isActive === false) result.reasons.push('This section is deactivated in Tax settings')
  if (row.effectiveNote) result.reasons.push(row.effectiveNote)

  if (perspective !== 'CUSTOMER') {
    const settings = await getFinanceSettings()
    if (settings.incomeTax?.isWithholdingEntity === false) {
      return {
        ...result,
        rate: 0,
        amount: 0,
        higherRateApplied: false,
        higherRateReason: null,
        reasons: ['Company is not set up as a withholding (TDS) entity — see Tax settings'],
      }
    }
  }
  return result
}

/**
 * VAT deducted at source suggestion. baseAmount = value EXCLUDING VAT.
 * perspective 'PAYEE' (default): we withhold from a supplier — zero unless the
 * company is a VDS entity. 'CUSTOMER': a client withholds from our invoice —
 * the supplier status is our own VAT registration.
 * @returns {Promise<{ serviceCode, label, vatRate, rate, amount, baseAmount, vatAmount, reasons: string[] }>}
 */
export async function suggestVds({
  serviceCode,
  baseAmount,
  vatAmount = null,
  supplierVatType = 'REGISTERED',
  date = new Date(),
  perspective = 'PAYEE',
} = {}) {
  const settings = await getFinanceSettings()
  let supplierType = supplierVatType || 'REGISTERED'

  if (perspective === 'CUSTOMER') {
    supplierType = settings.vat?.registrationType || 'REGISTERED'
  } else if (settings.vat?.isVdsEntity === false) {
    return {
      serviceCode: serviceCode ?? null, label: null, vatRate: null, rate: 0, amount: 0,
      baseAmount: round2(Number(baseAmount) || 0), vatAmount: moneyOrNull(vatAmount),
      reasons: ['Company is not a VDS withholding entity'],
    }
  }

  const code = serviceCode || (perspective === 'CUSTOMER' ? settings.vat?.defaultServiceCode : null)
  if (!code) return calcVds(null, { baseAmount, vatAmount, supplierVatType: supplierType })

  const row = await getVatServiceCode(code, date)
  if (!row) throw httpError(422, `Unknown VAT service code ${code}`)
  const result = calcVds(row, { baseAmount, vatAmount, supplierVatType: supplierType })
  if (row.effectiveNote) result.reasons.push(row.effectiveNote)
  return result
}

// ─── Tax sub-ledger ───────────────────────────────────────────────────────────

const MONEY_FIELDS = ['baseAmount', 'amount', 'sdAmount']

/**
 * Writes one TaxEntry. Fills period / fiscalYear from `date` (fiscal-year start
 * month from finance settings) and claimDeadline for INPUT_VAT / VDS_RECEIVABLE
 * (period + 6). Validates amount >= 0. Unless the entry is an opening balance or
 * `allowLocked` is set, refuses dates inside the books lock and, for VAT-type
 * entries, inside the VAT lock (filed return).
 * @returns {Promise<import('mongoose').Document>} the saved TaxEntry
 */
export async function recordTaxEntry(data, { userId = null, allowLocked = false } = {}) {
  if (!data || typeof data !== 'object') throw httpError(422, 'Tax entry data is required')
  const { entryType } = data
  if (!TAX_ENTRY_TYPES.includes(entryType)) throw httpError(422, `Unknown tax entry type ${entryType ?? ''}`.trim())

  const date = data.date ? toInstant(data.date) : null
  if (!date) throw httpError(422, 'A valid tax entry date is required')

  const amount = Number(data.amount)
  if (!Number.isFinite(amount)) throw httpError(422, 'Tax amount must be a number')
  if (amount < -0.005) throw httpError(422, 'Tax amount cannot be negative')
  for (const f of ['baseAmount', 'sdAmount']) {
    if (data[f] !== undefined && data[f] !== null && !Number.isFinite(Number(data[f]))) throw httpError(422, `${f} must be a number`)
  }
  if (data.sdAmount !== undefined && data.sdAmount !== null && Number(data.sdAmount) < -0.005) throw httpError(422, 'SD amount cannot be negative')

  const isOpening = data.isOpening === true
  if (!isOpening && !allowLocked) {
    const booksLocked = await assertBooksOpen(date)
    if (booksLocked) throw httpError(409, booksLocked)
    if (isVatEntryType(entryType)) {
      const taxLocked = await assertTaxOpen(date)
      if (taxLocked) throw httpError(409, taxLocked)
    }
  }

  const settings = await getFinanceSettings()
  const period = taxPeriodOf(date)
  const fiscalYear = fiscalYearOf(date, settings.fiscalYearStartMonth)

  const doc = { ...data }
  delete doc._id
  delete doc.id
  delete doc.entryNo
  delete doc.createdAt
  delete doc.updatedAt
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k]
  for (const f of MONEY_FIELDS) if (doc[f] !== undefined && doc[f] !== null) doc[f] = Math.max(0, round2(doc[f]))
  if (doc.rate !== undefined && doc.rate !== null) doc.rate = Number(doc.rate)

  doc.date = date
  doc.period = period
  doc.fiscalYear = fiscalYear
  doc.isOpening = isOpening
  doc.status = 'ACTIVE'
  if (['INPUT_VAT', 'VDS_RECEIVABLE'].includes(entryType) && !doc.claimDeadline) {
    doc.claimDeadline = addPeriods(period, CLAIM_WINDOW_PERIODS)
  }
  if (doc.documentDate) doc.documentDate = toInstant(doc.documentDate)
  if (doc.certificate?.date) doc.certificate = { ...doc.certificate, date: toInstant(doc.certificate.date) }
  if (doc.deposit?.date) doc.deposit = { ...doc.deposit, date: toInstant(doc.deposit.date) }
  if (userId && !doc.createdBy) doc.createdBy = userId

  try {
    return await new TaxEntry(doc).save()
  } catch (err) {
    if (err?.code === 11000 && entryType === 'OUTPUT_VAT') {
      throw httpError(409, 'Output VAT is already recorded for this invoice')
    }
    // One ACTIVE opening VAT balance b/f per side (index uniq_opening_vat_bf_side) —
    // matched on that index only, so an entryNo collision is never reported as this.
    if (err?.code === 11000 && entryType === 'VAT_BALANCE_BF' &&
        (err.keyPattern?.balanceSide || /uniq_opening_vat_bf_side/.test(String(err.message ?? '')))) {
      throw httpError(409, doc.balanceSide === 'PAYABLE'
        ? 'A VAT payable brought forward already exists — edit it instead'
        : 'A VAT credit brought forward already exists — edit it instead')
    }
    // One ACTIVE deposit per challan and type (index uniq_active_deposit_challan) —
    // the loser of two simultaneous submissions. Matched on that index only.
    if (err?.code === 11000 && (err.keyPattern?.challanKey || /uniq_active_deposit_challan/.test(String(err.message ?? '')))) {
      throw httpError(409, `Challan ${doc.deposit?.challanNo ?? ''} is already recorded`.replace('  ', ' '))
    }
    if (err?.name === 'ValidationError') {
      throw httpError(422, Object.values(err.errors ?? {}).map(e => e.message).join('; ') || 'Invalid tax entry')
    }
    throw err
  }
}

const toObjectId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)))

/**
 * Filter for the TDS / VDS payables (among `payableIds`) that one of the deposit
 * rows / claim tokens `depositIds` paid — in full (deposit.depositEntryId, also
 * legacy rows deposited before part payments existed) or in part (an allocation).
 */
export function depositReleaseFilter(payableIds, depositIds) {
  const ids = depositIds.map(toObjectId)
  return {
    _id: { $in: payableIds.map(toObjectId) },
    $or: [{ 'deposit.depositEntryId': { $in: ids } }, { 'deposit.allocations.depositEntryId': { $in: ids } }],
  }
}

/**
 * Update pipeline that takes the shares of `depositIds` off the matched payables:
 * drops their allocations, recomputes paidAmount from what is left and re-opens
 * the deduction (PENDING, challan fields cleared — what is left can no longer
 * cover it in full). Pair with depositReleaseFilter().
 */
export function depositReleasePipeline(depositIds) {
  const ids = depositIds.map(toObjectId)
  return [
    { $set: {
      'deposit.allocations': {
        $filter: { input: { $ifNull: ['$deposit.allocations', []] }, as: 'a', cond: { $not: [{ $in: ['$$a.depositEntryId', ids] }] } },
      },
    } },
    { $set: {
      'deposit.paidAmount':     { $round: [{ $sum: '$deposit.allocations.amount' }, 2] },
      'deposit.status':         'PENDING',
      'deposit.challanNo':      null,
      'deposit.date':           null,
      'deposit.depositEntryId': null,
      'deposit.accountCode':    null,
      updatedAt:                '$$NOW',
    } },
  ]
}

/**
 * Voids a TaxEntry (status VOID with reason). Idempotent for already-void rows,
 * unless `requireActive` (a user-initiated void): then an entry that is already
 * void — or was voided by a concurrent request — is a 409, so the caller's own
 * side effects (e.g. reversing money rows) never run twice.
 * Refuses when the entry is part of a filed return, or (unless allowLocked /
 * opening) when its date is inside the books or VAT lock. Voiding a deposit
 * (TDS_DEPOSIT / VAT_PAYMENT) re-opens the payables it settled.
 *
 * The ACTIVE → VOID flip is atomic and conditional on the entry being unchanged
 * since the checks above it ran (status ACTIVE + same updatedAt), so a double
 * submit voids once and a return being filed meanwhile (which stamps filingId /
 * claimPeriod on its entries) is never raced; on a lost race the checks re-run.
 */
export async function voidTaxEntry(id, { reason, userId = null, allowLocked = false, requireActive = false } = {}) {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) throw httpError(404, 'Tax entry not found')

  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = await TaxEntry.findById(id)
    if (!entry) throw httpError(404, 'Tax entry not found')
    if (entry.status === 'VOID') {
      if (requireActive) throw httpError(409, `${entry.entryNo ?? 'This entry'} is already void`)
      return entry
    }

    if (entry.filingId) {
      const filing = await TaxFiling.findById(entry.filingId).select('status periodKey kind').lean()
      if (filing && ['FILED', 'AMENDED'].includes(filing.status)) {
        throw httpError(409, `This entry is included in the filed return ${filing.periodKey} — record an adjustment instead`)
      }
    }

    if (!entry.isOpening && !allowLocked) {
      const booksLocked = await assertBooksOpen(entry.date)
      if (booksLocked) throw httpError(409, booksLocked)
      if (isVatEntryType(entry.entryType)) {
        const taxLocked = await assertTaxOpen(entry.date)
        if (taxLocked) throw httpError(409, taxLocked)
      }
    }

    const voided = await TaxEntry.findOneAndUpdate(
      { _id: entry._id, status: 'ACTIVE', updatedAt: entry.updatedAt ?? null },
      { $set: {
        status: 'VOID',
        voidReason: String(reason ?? '').trim() || 'Voided',
        voidedBy: userId || null,
        voidedAt: new Date(),
      } },
      { new: true },
    )
    if (!voided) continue // voided or changed meanwhile — re-read and re-check

    if (['TDS_DEPOSIT', 'VAT_PAYMENT'].includes(voided.entryType) && voided.settledEntryIds?.length) {
      // Take this challan's share off every payable it paid (in full or in part).
      await TaxEntry.updateMany(
        depositReleaseFilter(voided.settledEntryIds, [voided._id]),
        depositReleasePipeline([voided._id]),
      )
    }
    return voided
  }
  throw httpError(409, 'This tax entry is being changed by someone else — reload and try again')
}

// ─── Compliance calendar ─────────────────────────────────────────────────────

const KIND_ORDER = ['VAT_RETURN', 'TDS_DEPOSIT', 'WHT_RETURN', 'ADVANCE_TAX', 'INCOME_TAX_RETURN']

/** Noon (Dhaka) on the given day of a 'YYYY-MM' period — safe instant for helpers. */
function periodDate(period, day) {
  const [y, m] = period.split('-').map(Number)
  return dhakaDate(y, m - 1, day, 12)
}

/**
 * Statutory deadlines between `from` and `to` (inclusive; default today → +90 days).
 * Pure apart from reading the passed settings (pass getFinanceSettings()).
 * @returns {Array<{ key, kind, label, periodKey, dueDate, daysLeft, overdue }>} sorted by dueDate
 */
export function complianceCalendar({ from, to, settings } = {}) {
  const s = settings || {}
  const startMonth = Number(s.fiscalYearStartMonth) || 7
  const fromDate = toDate(from)
  const toD = to ? toDate(to) : new Date(fromDate.getTime() + 90 * DAY_MS)
  const fromKey = dhakaDayKey(fromDate)
  const toKey = dhakaDayKey(toD)
  if (toKey < fromKey) return []
  const todayKey = dhakaDayKey(new Date())

  const items = []
  const seen = new Set()
  const push = (item) => {
    if (!item?.dueDate || item.dueDate < fromKey || item.dueDate > toKey || seen.has(item.key)) return
    seen.add(item.key)
    items.push(item)
  }

  // Look back far enough for deadlines that fall long after their period (income-tax return ≈ 9 months).
  const periods = periodsBetween(addPeriods(taxPeriodOf(fromDate), -24), taxPeriodOf(toD))

  // VAT returns (Mushak-9.1) — registered persons only.
  if ((s.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED') {
    const freq = s.vat?.returnFrequency ?? 'MONTHLY'
    for (const p of periods) {
      const rp = vatReturnOverrideFor(p) ?? vatReturnPeriodFor(p, freq)
      if (!rp) continue
      push({ key: `VAT_RETURN:${rp.key}`, kind: 'VAT_RETURN', label: `VAT return (Mushak-9.1) — ${rp.label}`, periodKey: rp.key, dueDate: rp.dueDate })
    }
  }

  // TDS deposits (Rule 9) and the quarterly withholding return (s.177).
  if (s.incomeTax?.isWithholdingEntity !== false) {
    for (const p of periods) {
      const lastDay = periodLastDay(p)
      const isJune = p.endsWith('-06')
      const due = tdsDepositDueDate(parseDhakaDay(lastDay)?.start ?? periodDate(p, 28))
      push({
        key: `TDS_DEPOSIT:${p}`,
        kind: 'TDS_DEPOSIT',
        label: isJune
          ? `TDS deposit — ${periodLabel(p)} deductions (1–20 Jun: within 7 days; 21–29 Jun: next day; 30 Jun: same day)`
          : `TDS deposit — deductions of ${periodLabel(p)}`,
        periodKey: p,
        dueDate: due,
      })
      const q = whtQuarterOf(periodDate(p, 15), startMonth)
      if (q) push({ key: `WHT_RETURN:${q.key}`, kind: 'WHT_RETURN', label: `Withholding tax return (s.177) — ${q.label}`, periodKey: q.key, dueDate: q.dueDate })
    }
  }

  // Advance income tax instalments and the company income-tax return.
  const fys = [...new Set(periods.map(p => fiscalYearOf(periodDate(p, 15), startMonth)).filter(Boolean))]
  for (const fy of fys) {
    advanceTaxDueDates(fy).forEach((d, i) => push({
      key: `ADVANCE_TAX:${fy}-${i + 1}`, kind: 'ADVANCE_TAX',
      label: `Advance income tax — instalment ${i + 1} of 4 (FY ${fy})`, periodKey: fy, dueDate: d,
    }))
    const range = fiscalYearRange(fy, startMonth)
    if (range?.next) {
      // Company return: 15th day of the 9th month after the end of the income year.
      const { year, month } = dhakaParts(range.next)
      const due = dhakaDayKey(dhakaDate(year, month + 8, 15))
      push({ key: `INCOME_TAX_RETURN:${fy}`, kind: 'INCOME_TAX_RETURN', label: `Company income tax return — income year ${fy}`, periodKey: fy, dueDate: due })
    }
  }

  for (const it of items) {
    it.daysLeft = Math.round((Date.parse(`${it.dueDate}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS)
    it.overdue = it.dueDate < todayKey
  }
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

// ─── Cash-payment ratio (ITA 2023 s.55 cash rules) ───────────────────────────

const SALARY_RENT_RE = '\\b(salar(y|ies)|wages?|rent(al)?)\\b'

/**
 * Share of a fiscal year's expense payments made in cash.
 * Over EXPENSE Transactions with an accountId, kind OPERATING / ASSET_PURCHASE
 * (missing kind = OPERATING), dated in the FY. Cash = channel CASH or a CASH /
 * PETTY_CASH money account. Amounts are amountBDT (BDT rows fall back to amount).
 * Reversal rows (reversalOf set) offset the side of the row they reverse instead
 * of counting on their own type, so a reversed cash payment nets to zero (and a
 * reversed receipt never becomes a cash expense). Sums are floored at zero.
 * If the ratio exceeds settings.incomeTax.cashRatioThresholdPct, cashDisallowPct
 * of the cash payments is estimated as disallowed.
 */
export async function cashPaymentRatio(fiscalYear) {
  const settings = await getFinanceSettings()
  const startMonth = settings.fiscalYearStartMonth
  const fy = fiscalYear || fiscalYearOf(new Date(), startMonth)
  const range = fiscalYearRange(fy, startMonth)
  if (!range) throw httpError(422, `Invalid fiscal year ${fiscalYear}`)

  const thresholdPct = Number(settings.incomeTax?.cashRatioThresholdPct ?? 50)
  const disallowPct = Number(settings.incomeTax?.cashDisallowPct ?? 25)

  const cashAccounts = await MoneyAccount.find({ type: { $in: ['CASH', 'PETTY_CASH'] } }).select('_id').lean()
  const cashIds = cashAccounts.map(a => a._id)

  const toNum = (expr) => ({ $convert: { input: expr, to: 'double', onError: 0, onNull: 0 } })
  const amountBDT = {
    $cond: [
      { $ne: [{ $ifNull: ['$amountBDT', null] }, null] },
      toNum('$amountBDT'),
      { $cond: [{ $in: [{ $ifNull: ['$currency', 'BDT'] }, ['BDT', '']] }, toNum('$amount'), 0] },
    ],
  }
  const isCash = { $or: [{ $eq: ['$channel', 'CASH'] }, { $in: ['$accountId', cashIds] }] }
  const isReversal = { $ne: [{ $ifNull: ['$reversalOf', null] }, null] }
  const textOf = (f) => ({ $convert: { input: { $ifNull: [f, ''] }, to: 'string', onError: '', onNull: '' } })
  const isSalaryRent = {
    $or: [
      { $regexMatch: { input: textOf('$category'), regex: SALARY_RENT_RE, options: 'i' } },
      { $regexMatch: { input: textOf('$expenseCategory'), regex: SALARY_RENT_RE, options: 'i' } },
    ],
  }

  const rows = await Transaction.aggregate([
    {
      $match: {
        date: { $gte: range.start, $lt: range.next },
        accountId: { $ne: null },
        type: { $in: ['EXPENSE', 'INCOME'] },
        $or: [{ kind: { $exists: false } }, { kind: null }, { kind: { $in: ['OPERATING', 'ASSET_PURCHASE'] } }],
      },
    },
    // A reversal (reversalOf set) is posted with the opposite type but the same
    // kind, account and channel: count it on the side of the row it reverses,
    // negatively, in its own income year (same rule as plEffect in the P&L).
    { $project: {
      side:    { $cond: [isReversal, { $cond: [{ $eq: ['$type', 'INCOME'] }, 'EXPENSE', 'INCOME'] }, '$type'] },
      sign:    { $cond: [isReversal, -1, 1] },
      amt:     amountBDT,
      cash:    isCash,
      salRent: isSalaryRent,
    } },
    { $project: { side: 1, sign: 1, cash: 1, salRent: 1, samt: { $multiply: ['$sign', '$amt'] } } },
    {
      $group: {
        _id: '$side',
        total: { $sum: '$samt' },
        cash: { $sum: { $cond: ['$cash', '$samt', 0] } },
        cashSalaryRent: { $sum: { $cond: [{ $and: ['$cash', '$salRent'] }, '$samt', 0] } },
        count: { $sum: '$sign' },
        cashCount: { $sum: { $cond: ['$cash', '$sign', 0] } },
      },
    },
  ])

  const exp = rows.find(r => r._id === 'EXPENSE') ?? {}
  const inc = rows.find(r => r._id === 'INCOME') ?? {}
  // A reversal of an earlier year's payment can take this year's sums below zero.
  const pos = (v) => round2(Math.max(0, Number(v) || 0))
  const totalBDT = pos(exp.total)
  const cashBDT = pos(exp.cash)
  const ratioPct = totalBDT > 0 ? round2((Math.min(cashBDT, totalBDT) / totalBDT) * 100) : 0
  const incomeCashBDT = pos(inc.cash)

  return {
    fiscalYear:          range.fy ?? fy,
    startDay:            range.startDay ?? dhakaDayKey(range.start),
    endDay:              range.endDay ?? null,
    cashBDT,
    totalBDT,
    ratioPct,
    thresholdPct,
    disallowPct,
    overThreshold:       ratioPct > thresholdPct,
    disallowEstimateBDT: ratioPct > thresholdPct ? round2((cashBDT * disallowPct) / 100) : 0,
    cashSalaryRentBDT:   pos(exp.cashSalaryRent),
    paymentCount:        Math.max(0, exp.count ?? 0),
    cashPaymentCount:    Math.max(0, exp.cashCount ?? 0),
    incomeTotalBDT:      pos(inc.total),
    incomeCashBDT,
    // Reduced corporate rate needs every transaction through banking channels.
    cashlessEligible:    cashBDT < 0.005 && incomeCashBDT < 0.005,
  }
}

// ─── Small shared helpers for other tax modules ──────────────────────────────

/** Number or null, rounded to 2 dp (for optional money inputs). */
export function moneyOrNull(v) {
  const n = num(v)
  return n === null || !Number.isFinite(n) ? null : round2(n)
}
