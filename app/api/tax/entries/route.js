export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry, Transaction } from '@/models'
import { requirePerm, canDoAny } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { logActivity } from '@/lib/logActivity'
import { maskList, TAX_ENTRY_PII } from '@/lib/pii'
import { recordTaxEntry } from '@/lib/tax/engine'
import { postMoneyEntry } from '@/lib/finance/ledger'
import { getFinanceSettings, requireAccountIfLive, assertBooksOpen } from '@/lib/finance/settings'
import { isPeriod, taxPeriodOf, addPeriods, vatReturnPeriodFor, periodLabel } from '@/lib/finance/fiscal'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'
import {
  round2, isValidBin, isValidTin, normalizeBin, normalizeTin, inputVatCreditability, vatReturnNoteOf,
  INPUT_NON_CREDIT_REASONS, VAT_INCREASE_NOTES, TAX_ENTRY_TYPE_META, CERTIFICATE_STATUSES, DEPOSIT_STATUSES,
  CLAIM_WINDOW_PERIODS, vatReturnOverrideFor,
} from '@/lib/tax/catalog'
import {
  errorResponse, escapeRegex, parseEntryTypes, parseDay, todayKey, serializeEntry, tdsDueInfo,
  toCsv, csvResponse, money2, httpError,
} from './_lib/common'
import { findActiveChallan } from './_lib/deposits'
import { codeContains } from '@/lib/codes'
import { z } from 'zod'

const CERT_VALUES = CERTIFICATE_STATUSES.map(s => s.value)
const DEPOSIT_VALUES = DEPOSIT_STATUSES.map(s => s.value)
const MAX_CSV_ROWS = 10000

// ── GET filters ─────────────────────────────────────────────────────────────

function buildFilter(sp) {
  const filter = {}
  const types = parseEntryTypes(sp.get('entryType'))
  if (types.length) filter.entryType = types.length === 1 ? types[0] : { $in: types }

  const status = (sp.get('status') || 'ACTIVE').toUpperCase()
  if (status !== 'ALL') {
    if (!['ACTIVE', 'VOID'].includes(status)) throw httpError(400, 'status must be ACTIVE, VOID or all')
    filter.status = status
  }

  const period = sp.get('period')
  if (period) {
    if (!isPeriod(period)) throw httpError(400, 'period must be YYYY-MM')
    filter.period = period
  }
  const fy = sp.get('fiscalYear')
  if (fy) {
    if (!/^\d{4}(-\d{2})?$/.test(fy)) throw httpError(400, 'fiscalYear must look like 2026-27')
    filter.fiscalYear = fy
  }

  const start = sp.get('startDate')
  const end = sp.get('endDate')
  if (start || end) {
    filter.date = {}
    if (start) {
      const d = parseDay(start)
      if (!d) throw httpError(400, 'startDate must be YYYY-MM-DD')
      filter.date.$gte = d.start
    }
    if (end) {
      const d = parseDay(end)
      if (!d) throw httpError(400, 'endDate must be YYYY-MM-DD')
      filter.date.$lt = d.next
    }
  }

  const certificateStatus = sp.get('certificateStatus')
  if (certificateStatus) {
    const list = certificateStatus.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (list.some(s => !CERT_VALUES.includes(s))) throw httpError(400, 'Unknown certificate status')
    filter['certificate.status'] = { $in: list }
  }
  const depositStatus = sp.get('depositStatus')
  if (depositStatus) {
    const list = depositStatus.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (list.some(s => !DEPOSIT_VALUES.includes(s))) throw httpError(400, 'Unknown deposit status')
    filter['deposit.status'] = { $in: list }
  }

  const isOpening = sp.get('isOpening')
  if (isOpening === '1' || isOpening === 'true') filter.isOpening = true
  else if (isOpening === '0' || isOpening === 'false') filter.isOpening = { $ne: true }

  const section = sp.get('section')
  // Catalog codes are upper-case ('90-OTHER'); bank-interest AIT uses 'Interest (bank)'.
  if (section?.trim()) filter.section = { $regex: `^${escapeRegex(section.trim())}$`, $options: 'i' }

  for (const key of ['invoiceId', 'expenseId', 'projectPaymentId', 'filingId', 'transactionId']) {
    const v = sp.get(key)
    if (v) {
      if (!/^[a-f\d]{24}$/i.test(v)) throw httpError(400, `Invalid ${key}`)
      filter[key] = new mongoose.Types.ObjectId(v) // aggregate $match does not cast strings
    }
  }
  const partyId = sp.get('partyId')
  if (partyId) filter.partyId = partyId

  const and = []
  const partyName = sp.get('partyName')
  if (partyName?.trim()) filter.partyName = { $regex: escapeRegex(partyName.trim()), $options: 'i' }
  const search = sp.get('search')
  if (search?.trim()) {
    const rx   = { $regex: escapeRegex(search.trim()), $options: 'i' }
    // Entry, document and certificate numbers match with separators ignored
    // (TAX-2610-00001 = TAX261000001; a typed document number still matches as typed).
    const code = codeContains(search)
    const codes = code ? [{ entryNo: code }, { documentNo: code }, { 'certificate.number': code }] : []
    and.push({ $or: [...codes, { partyName: rx }, { partyBin: rx }, { 'deposit.challanNo': rx }] })
  }
  if (and.length) filter.$and = and
  return filter
}

const LIST_POPULATE = [
  { path: 'createdBy', select: 'name' },
  { path: 'voidedBy', select: 'name' },
  { path: 'filingId', select: 'kind periodKey status' },
  { path: 'invoiceId', select: 'invoiceNumber' },
  { path: 'transactionId', select: 'txnId accountId amount kind', populate: { path: 'accountId', select: 'name type last4' } },
]

function decorate(row) {
  const out = serializeEntry(row)
  out.note = vatReturnNoteOf(row)
  out.typeLabel = TAX_ENTRY_TYPE_META[row.entryType]?.label ?? row.entryType
  if (row.entryType === 'TDS_PAYABLE' && row.status === 'ACTIVE' && row.deposit?.status === 'PENDING') {
    out.depositDue = tdsDueInfo(row)
  }
  return out
}

const CSV_COLUMNS = [
  { label: 'Entry no',          value: r => r.entryNo },
  { label: 'Date',              value: r => r.date },
  { label: 'Period',            value: r => r.period },
  { label: 'Fiscal year',       value: r => r.fiscalYear },
  { label: 'Type',              value: r => r.typeLabel },
  { label: 'Status',            value: r => r.status },
  { label: 'Opening',           value: r => (r.isOpening ? 'Yes' : '') },
  { label: 'Party',             value: r => r.partyName },
  { label: 'Party BIN',         value: r => r.partyBin },
  { label: 'Party TIN',         value: r => r.partyTin },
  { label: 'Document',          value: r => r.documentNo },
  { label: 'Document date',     value: r => r.documentDate },
  { label: 'Base / value',      value: r => money2(r.baseAmount) },
  { label: 'Rate %',            value: r => (r.rate ?? '') },
  { label: 'Tax amount',        value: r => money2(r.amount) },
  { label: 'SD',                value: r => money2(r.sdAmount) },
  { label: 'Treatment',         value: r => r.treatment },
  { label: 'Creditable',        value: r => (r.creditable === true ? 'Yes' : r.creditable === false ? 'No' : '') },
  { label: 'Non-credit reason', value: r => (r.nonCreditReason ? INPUT_NON_CREDIT_REASONS[r.nonCreditReason] ?? r.nonCreditReason : '') },
  { label: 'TDS section',       value: r => r.section },
  { label: '9.1 note',          value: r => r.note ?? '' },
  { label: 'Certificate',       value: r => r.certificate?.status },
  { label: 'Certificate no',    value: r => r.certificate?.number },
  { label: 'Certificate date',  value: r => r.certificate?.date },
  { label: 'Deposit',           value: r => r.deposit?.status },
  { label: 'Challan no',        value: r => r.deposit?.challanNo },
  { label: 'Challan date',      value: r => r.deposit?.date },
  { label: 'Return',            value: r => (r.filingId && typeof r.filingId === 'object' ? `${r.filingId.periodKey} (${r.filingId.status})` : '') },
  { label: 'Void reason',       value: r => r.voidReason },
  { label: 'Notes',             value: r => r.notes },
]

// GET /api/tax/entries — tax ledger
//   ?entryType=A,B&status=ACTIVE|VOID|all&period=YYYY-MM&fiscalYear=2026-27&startDate&endDate
//   &partyName=&search=&certificateStatus=&depositStatus=&isOpening=1|0&section=&page&limit&format=csv
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    let filter
    try { filter = buildFilter(searchParams) } catch (err) { return errorResponse(err, '[GET /api/tax/entries]') }

    const sortParam = searchParams.get('sort')
    const sort = sortParam === 'date_asc' ? { date: 1, entryNo: 1 } : { date: -1, entryNo: -1 }
    const format = searchParams.get('format')

    await connectDB()

    if (format === 'csv') {
      const rows = await TaxEntry.find(filter).sort(sort).limit(MAX_CSV_ROWS).populate(LIST_POPULATE).lean()
      const data = maskList(session, rows.map(decorate), TAX_ENTRY_PII)
      return csvResponse(toCsv(CSV_COLUMNS, data), `tax-ledger-${todayKey()}.csv`)
    }

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10) || 25))

    const [rows, total, sums] = await Promise.all([
      TaxEntry.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).populate(LIST_POPULATE).lean(),
      TaxEntry.countDocuments(filter),
      TaxEntry.aggregate([
        { $match: filter },
        { $group: { _id: null, amount: { $sum: '$amount' }, baseAmount: { $sum: '$baseAmount' }, sdAmount: { $sum: '$sdAmount' } } },
      ]),
    ])

    return NextResponse.json({
      data: maskList(session, rows.map(decorate), TAX_ENTRY_PII),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      totals: {
        count: total,
        amount: round2(sums[0]?.amount ?? 0),
        baseAmount: round2(sums[0]?.baseAmount ?? 0),
        sdAmount: round2(sums[0]?.sdAmount ?? 0),
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/tax/entries]')
  }
}

// ── POST schemas ────────────────────────────────────────────────────────────

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable()).optional()
const money = z.coerce.number().finite().min(0, 'Must be 0 or more').max(1e12)
const posMoney = z.coerce.number().finite().gt(0, 'Must be more than 0').max(1e12)
const optMoney = z.preprocess(v => (empty(v) ? null : v), money.nullable()).optional()
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optDay = z.preprocess(v => (empty(v) ? null : v), dayStr.nullable()).optional()
const rate = z.preprocess(v => (empty(v) ? null : v), z.coerce.number().finite().min(0).max(100).nullable()).optional()
const attachments = z.array(z.string().trim().max(500).regex(UPLOAD_URL_RE, 'Attach files with the upload button')).max(10).optional()
const partyName = z.string().trim().min(1, 'Enter the party name').max(200)

const common = {
  date:         dayStr,
  notes:        optText(1000),
  attachments,
  documentNo:   optText(80),
  documentDate: optDay,
}

const SCHEMAS = {
  VAT_ADJUSTMENT: z.object({
    ...common,
    entryType:      z.literal('VAT_ADJUSTMENT'),
    direction:      z.enum(['INCREASE', 'DECREASE']),
    adjustmentNote: z.preprocess(v => (empty(v) ? null : v), z.coerce.number().int().nullable()).optional(),
    amount:         posMoney,
    reason:         z.string().trim().min(5, 'Explain the adjustment (at least 5 characters)').max(1000),
  }),
  INPUT_VAT: z.object({
    ...common,
    entryType:       z.literal('INPUT_VAT'),
    partyName,
    partyBin:        optText(20),
    supplierVatType: z.enum(['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN']).default('REGISTERED'),
    baseAmount:      money,
    amount:          money,
    sdAmount:        optMoney,
    rate,
    treatment:       z.enum(['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT']).default('STANDARD'),
    serviceCode:     optText(32),
    creditable:      z.boolean(),
    nonCreditReason: z.preprocess(v => (empty(v) ? null : v), z.enum(Object.keys(INPUT_NON_CREDIT_REASONS)).nullable()).optional(),
    bankingChannel:  z.boolean().default(true),
  }),
  OUTPUT_VAT: z.object({
    ...common,
    entryType:   z.literal('OUTPUT_VAT'),
    partyName,
    partyBin:    optText(20),
    documentNo:  z.string().trim().min(1, 'Enter the Mushak-6.3 / invoice number').max(80),
    baseAmount:  money,
    amount:      money,
    sdAmount:    optMoney,
    rate,
    treatment:   z.enum(['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT']),
    serviceCode: optText(32),
  }),
  TDS_RECEIVABLE: z.object({
    ...common,
    entryType:       z.literal('TDS_RECEIVABLE'),
    partyName,
    partyType:       z.enum(['CLIENT', 'OTHER']).default('OTHER'),
    partyTin:        optText(20),
    section:         optText(32),
    baseAmount:      optMoney,
    rate,
    amount:          posMoney,
    certificateNo:   optText(60),
    certificateDate: optDay,
  }),
  ADVANCE_TAX: z.object({
    ...common,
    entryType:   z.literal('ADVANCE_TAX'),
    amount:      posMoney,
    challanNo:   z.string().trim().min(1, 'Enter the challan number').max(60),
    accountId:   optText(24),
    bank:        optText(120),
    branch:      optText(120),
    accountCode: optText(60),
    instalment:  z.preprocess(v => (empty(v) ? null : v), z.coerce.number().int().min(1).max(4).nullable()).optional(),
  }),
}

function fieldError(field, message) {
  return NextResponse.json({ error: message, details: { fieldErrors: { [field]: [message] } } }, { status: 422 })
}

// POST /api/tax/entries — manual tax entry
//   VAT_ADJUSTMENT | INPUT_VAT | OUTPUT_VAT | TDS_RECEIVABLE (tax.manage)
//   ADVANCE_TAX (tax.deposits.manage; with accountId also posts a TAX_PAYMENT transaction)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['tax.manage', 'tax.deposits.manage'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const type = String(body?.entryType ?? '').toUpperCase()
    const schema = SCHEMAS[type]
    if (!schema) {
      return NextResponse.json({ error: `Manual entries can be ${Object.keys(SCHEMAS).join(', ')}` }, { status: 422 })
    }
    const typeDenied = requirePerm(session, type === 'ADVANCE_TAX' ? 'tax.deposits.manage' : 'tax.manage')
    if (typeDenied) return typeDenied

    const parsed = schema.safeParse({ ...body, entryType: type })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data

    const day = parseDay(d.date)
    if (!day) return fieldError('date', 'Enter a valid date')
    if (day.key > todayKey()) return fieldError('date', 'The date cannot be in the future')
    let documentDate = null
    if (d.documentDate) {
      const dd = parseDay(d.documentDate)
      if (!dd) return fieldError('documentDate', 'Enter a valid document date')
      documentDate = dd.start
    }

    // Party identifiers
    let partyBin = null
    if (d.partyBin) {
      if (!isValidBin(d.partyBin)) return fieldError('partyBin', 'BIN is 9 or 13 digits, e.g. 000123456-0101')
      partyBin = normalizeBin(d.partyBin)
    }
    let partyTin = null
    if (d.partyTin && !String(d.partyTin).includes('••')) {
      if (!isValidTin(d.partyTin)) return fieldError('partyTin', 'TIN is 12 digits')
      partyTin = normalizeTin(d.partyTin)
    }

    await connectDB()
    const settings = await getFinanceSettings()
    const userId = session.user.id
    const registered = (settings?.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED'

    const data = {
      entryType:    type,
      date:         day.start,
      notes:        d.notes ?? null,
      attachments:  d.attachments ?? [],
      documentNo:   d.documentNo ?? null,
      documentDate,
    }
    let allowLocked = false

    if (type === 'VAT_ADJUSTMENT') {
      let note = d.adjustmentNote ?? (d.direction === 'INCREASE' ? 27 : 32)
      if (d.direction === 'INCREASE' && !VAT_INCREASE_NOTES.includes(note)) {
        return fieldError('adjustmentNote', `An increasing adjustment goes to note ${VAT_INCREASE_NOTES.join(', ')}`)
      }
      if (d.direction === 'DECREASE') {
        if (note !== 32) return fieldError('adjustmentNote', 'A decreasing adjustment goes to note 32')
        note = 32
      }
      Object.assign(data, {
        adjustmentDirection: d.direction,
        adjustmentNote:      note,
        amount:              round2(d.amount),
        baseAmount:          0,
        partyType:           'OTHER',
        notes:               [d.reason, d.notes].filter(Boolean).join(' — '),
      })
    } else if (type === 'INPUT_VAT') {
      const sd = round2(d.sdAmount ?? 0)
      const vat = round2(d.amount)
      if (['ZERO_RATED', 'EXEMPT'].includes(d.treatment) && vat > 0.005) {
        return fieldError('amount', 'Zero-rated / exempt purchases carry no VAT')
      }
      // s.46 claim window: the Mushak-6.3's own period (else the entry date) + 6
      // periods — the same rule as bill payments (lib/expensePayment.js) and the
      // PUT route. The earliest return this credit can reach is the one holding the entry date.
      const claimDeadline = addPeriods(taxPeriodOf(documentDate ?? day.start), CLAIM_WINDOW_PERIODS)
      const entryPeriod = taxPeriodOf(day.start)
      const entryReturn = vatReturnOverrideFor(entryPeriod)
        ?? vatReturnPeriodFor(entryPeriod, settings?.vat?.returnFrequency ?? 'MONTHLY')
      const expired = !!claimDeadline && claimDeadline < (entryReturn?.start ?? entryPeriod)
      let creditable = d.creditable && vat > 0
      let reason = d.nonCreditReason ?? null
      if (d.creditable && vat > 0) {
        if (!registered) {
          return fieldError('creditable', `The company's VAT registration type is ${settings.vat.registrationType} — input VAT cannot be credited`)
        }
        if (expired) {
          return fieldError('documentDate', `This Mushak-6.3 could be claimed only up to the ${periodLabel(claimDeadline)} return (6 tax periods, s.46) — record it as not creditable`)
        }
        const check = inputVatCreditability({
          ourTreatment:    settings?.vat?.defaultSalesTreatment || 'STANDARD',
          supplierVatType: d.supplierVatType,
          hasMushak:       !!d.documentNo && !!partyBin,
          excludedItem:    false,
          grossAmount:     round2(d.baseAmount + sd + vat),
          bankingChannel:  d.bankingChannel,
        })
        if (!check.creditable) {
          return fieldError('creditable', `Not creditable: ${INPUT_NON_CREDIT_REASONS[check.reason] ?? check.reason}`)
        }
        reason = null
      } else {
        creditable = false
        if (!reason && expired) reason = 'EXPIRED'
        if (!reason) {
          const check = inputVatCreditability({
            ourTreatment:    settings?.vat?.defaultSalesTreatment || 'STANDARD',
            supplierVatType: d.supplierVatType,
            hasMushak:       !!d.documentNo && !!partyBin,
            grossAmount:     round2(d.baseAmount + sd + vat),
            bankingChannel:  d.bankingChannel,
          })
          reason = check.reason ?? 'OTHER'
        }
      }
      // Input VAT is claimable within 6 periods, so it may be dated inside a filed
      // VAT period (it flows into the first open return); only the books lock applies.
      allowLocked = true
      const locked = await assertBooksOpen(day.start)
      if (locked) return NextResponse.json({ error: locked }, { status: 409 })
      Object.assign(data, {
        partyType:       'VENDOR',
        partyName:       d.partyName,
        partyBin,
        baseAmount:      round2(d.baseAmount),
        amount:          vat,
        sdAmount:        sd,
        rate:            d.rate ?? (d.baseAmount > 0 ? round2((vat * 100) / (d.baseAmount + sd)) : null),
        treatment:       d.treatment,
        serviceCode:     d.serviceCode ?? null,
        creditable,
        nonCreditReason: creditable ? null : reason,
        bankingChannel:  d.bankingChannel,
        claimDeadline,
      })
    } else if (type === 'OUTPUT_VAT') {
      if (!registered) {
        return fieldError('entryType', `The company's VAT registration type is ${settings.vat.registrationType} — no output VAT is recorded`)
      }
      const sd = round2(d.sdAmount ?? 0)
      const vat = round2(d.amount)
      if (['ZERO_RATED', 'EXEMPT'].includes(d.treatment) && vat > 0.005) {
        return fieldError('amount', 'Zero-rated / exempt supplies carry no VAT')
      }
      if (d.rate != null && ['STANDARD', 'REDUCED'].includes(d.treatment)) {
        const expected = round2(((d.baseAmount + sd) * d.rate) / 100)
        if (Math.abs(expected - vat) > 1) {
          return fieldError('amount', `VAT at ${d.rate}% of ${round2(d.baseAmount + sd)} is ${expected}`)
        }
      }
      Object.assign(data, {
        partyType:   'CLIENT',
        partyName:   d.partyName,
        partyBin,
        baseAmount:  round2(d.baseAmount),
        amount:      vat,
        sdAmount:    sd,
        rate:        d.rate ?? (d.baseAmount > 0 ? round2((vat * 100) / (d.baseAmount + sd)) : 0),
        treatment:   d.treatment,
        serviceCode: d.serviceCode ?? null,
        documentNo:  d.documentNo,
      })
    } else if (type === 'TDS_RECEIVABLE') {
      let certificate = { status: 'PENDING' }
      if (d.certificateNo) {
        if (!d.certificateDate) return fieldError('certificateDate', 'Enter the certificate date')
        const cd = parseDay(d.certificateDate)
        if (!cd) return fieldError('certificateDate', 'Enter a valid certificate date')
        if (cd.key > todayKey()) return fieldError('certificateDate', 'The certificate date cannot be in the future')
        if (cd.key < day.key) return fieldError('certificateDate', 'The certificate date is before the deduction date')
        certificate = { status: 'RECEIVED', number: d.certificateNo, date: cd.start }
      }
      Object.assign(data, {
        partyType:  d.partyType,
        partyName:  d.partyName,
        partyTin,
        section:    d.section ? d.section.toUpperCase() : null,
        baseAmount: round2(d.baseAmount ?? 0),
        rate:       d.rate ?? (d.baseAmount ? round2((d.amount * 100) / d.baseAmount) : null),
        amount:     round2(d.amount),
        certificate,
      })
    } else if (type === 'ADVANCE_TAX') {
      if (!d.accountId) {
        const missing = await requireAccountIfLive(day.start, null)
        if (missing) return fieldError('accountId', 'Select the account the advance tax was paid from')
      }
      const parts = []
      if (d.instalment) parts.push(`Instalment ${d.instalment} of 4`)
      if (d.notes) parts.push(d.notes)
      Object.assign(data, {
        amount:      round2(d.amount),
        baseAmount:  0,
        documentNo:  d.challanNo,
        documentDate: day.start,
        deposit:     { status: 'DEPOSITED', challanNo: d.challanNo, date: day.start, accountCode: d.accountCode ?? null },
        challan:     { bank: d.bank ?? null, branch: d.branch ?? null, accountCode: d.accountCode ?? null },
        bankingChannel: true,
        // The instalment paid drives the compliance calendar (the note is for display only).
        instalment:  d.instalment ?? null,
        notes:       parts.join(' — ') || null,
      })
    }

    // Duplicate challan for advance tax (case / separators ignored; the unique
    // index on challanKey refuses a simultaneous duplicate inside recordTaxEntry)
    if (type === 'ADVANCE_TAX') {
      const dup = await findActiveChallan('ADVANCE_TAX', d.challanNo)
      if (dup) return NextResponse.json({ error: `Challan ${d.challanNo} is already recorded (${dup.entryNo})` }, { status: 409 })
    }

    const entry = await recordTaxEntry(data, { userId, allowLocked })

    let transaction = null
    if (type === 'ADVANCE_TAX' && d.accountId) {
      try {
        transaction = await postMoneyEntry({
          type:        'EXPENSE',
          kind:        'TAX_PAYMENT',
          category:    'Advance Income Tax',
          amount:      round2(d.amount),
          currency:    'BDT',
          amountBDT:   round2(d.amount),
          date:        day.start,
          accountId:   d.accountId,
          channel:     'CHALLAN',
          reference:   d.challanNo,
          description: `Advance income tax${d.instalment ? ` — instalment ${d.instalment}` : ''} — challan ${d.challanNo} (FY ${entry.fiscalYear})`,
          taxEntryIds: [entry._id],
        }, { userId })
        await TaxEntry.updateOne({ _id: entry._id }, { $set: { transactionId: transaction._id } })
      } catch (err) {
        await TaxEntry.deleteOne({ _id: entry._id }).catch(e => console.error('[POST /api/tax/entries] compensating delete failed', e))
        if (transaction?._id) await Transaction.deleteOne({ _id: transaction._id }).catch(() => {})
        throw err
      }
    }

    logActivity({
      userId,
      userRole: session.user.role,
      action:   type === 'ADVANCE_TAX' ? 'DEPOSIT' : 'CREATE',
      entity:   'TAX_ENTRY',
      entityId: entry._id.toString(),
      changes:  JSON.stringify({
        entryNo: entry.entryNo, entryType: type, date: day.key, amount: entry.amount,
        baseAmount: entry.baseAmount, partyName: entry.partyName ?? null, documentNo: entry.documentNo ?? null,
        transactionId: transaction?._id?.toString() ?? null,
      }),
      request,
    })

    const fresh = await TaxEntry.findById(entry._id).populate(LIST_POPULATE).lean()
    const [row] = maskList(session, [decorate(fresh)], TAX_ENTRY_PII)
    return NextResponse.json({ data: row, transactionId: transaction?._id?.toString() ?? null }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/tax/entries]')
  }
}
