/**
 * Validation & normalisation of opening tax balances (B2). Not a route.
 *
 * Opening tax balances are ordinary TaxEntries with isOpening:true, dated
 * before the go-live date. This module turns a request body into the TaxEntry
 * fields for one of the allowed entry types, enforcing the per-type rules.
 */

import { z } from 'zod'
import {
  normalizeBin, isValidBin, normalizeTin, isValidTin, CLAIM_WINDOW_PERIODS,
} from '@/lib/tax/catalog'
import { addDays, addPeriods, dayKeyLabel, fiscalYearOf, isDayKey, periodLabel, taxPeriodOf } from '@/lib/finance/fiscal'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { isMaskedValue } from '@/lib/pii'
import { OPENING_TAX_TYPES, round2 } from '@/app/admin/finance/opening-balances/_lib/position'
import { httpError } from '@/app/api/finance/periods/_lib/locks'

const blankToNull = (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v)

const optStr = (max) => z.preprocess(
  (v) => (v === undefined || v === null ? null : (String(v).trim() || null)),
  z.string().max(max, `Must be at most ${max} characters`).nullable(),
).optional()

/** '1,500.50' | 1500.5 → 1500.5; blank → null (optional) / undefined (required); junk → NaN (rejected). */
const toNumberish = (blank) => (v) => {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return blank
  if (typeof v === 'string') return Number(v.replace(/,/g, '').trim())
  return v
}
const moneyNumber = z.number({ required_error: 'Enter the amount', invalid_type_error: 'Enter a valid amount' })
  .finite('Enter a valid amount').min(0, 'Cannot be negative').max(1e12, 'Amount is too large')

const optMoney = z.preprocess(toNumberish(null), moneyNumber.nullable()).optional()

const daySchema = z.string().trim().refine(isDayKey, 'Use a valid date (YYYY-MM-DD)')
const optDay = z.preprocess(blankToNull, daySchema.nullable()).optional()

const certificateSchema = z.object({
  status: z.enum(['NOT_REQUIRED', 'PENDING', 'RECEIVED', 'ISSUED']).optional(),
  number: optStr(60),
  date:   optDay,
}).nullable().optional()

export const openingTaxSchema = z.object({
  entryType:   z.enum(OPENING_TAX_TYPES, { errorMap: () => ({ message: 'Choose the kind of tax balance' }) }),
  amount:      z.preprocess(toNumberish(undefined), moneyNumber),
  sdAmount:    optMoney,
  baseAmount:  optMoney,
  rate:        z.preprocess(toNumberish(null), z.number({ invalid_type_error: 'Enter a valid rate' }).finite().min(0).max(100).nullable()).optional(),
  date:        daySchema,
  balanceSide: z.preprocess(blankToNull, z.enum(['CREDIT', 'PAYABLE']).nullable()).optional(),
  treatment:   z.preprocess(blankToNull, z.enum(['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT']).nullable()).optional(),
  partyType:   z.preprocess(blankToNull, z.enum(['CLIENT', 'VENDOR', 'FREELANCER', 'AGENCY', 'EMPLOYEE', 'OTHER']).nullable()).optional(),
  partyName:   optStr(200),
  partyBin:    optStr(30),
  partyTin:    optStr(30),
  documentNo:  optStr(80),
  documentDate: optDay,
  section:     optStr(40),
  payeeType:   z.preprocess(blankToNull, z.enum(['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT']).nullable()).optional(),
  certificate: certificateSchema,
  notes:       optStr(1000),
}).strip()

const PARTY_REQUIRED = {
  INPUT_VAT:      'Enter the supplier\'s name',
  VDS_RECEIVABLE: 'Enter the client\'s name',
  TDS_RECEIVABLE: 'Enter the client\'s name',
  TDS_PAYABLE:    'Enter the payee\'s name',
  VDS_PAYABLE:    'Enter the supplier\'s name',
}

const DEFAULT_PARTY_TYPE = {
  INPUT_VAT:      'VENDOR',
  VDS_RECEIVABLE: 'CLIENT',
  TDS_RECEIVABLE: 'CLIENT',
  TDS_PAYABLE:    'OTHER',
  VDS_PAYABLE:    'VENDOR',
}

const CERT_STATUSES = {
  VDS_RECEIVABLE: ['PENDING', 'RECEIVED'],
  TDS_RECEIVABLE: ['PENDING', 'RECEIVED'],
  TDS_PAYABLE:    ['PENDING', 'ISSUED'],
  VDS_PAYABLE:    ['PENDING', 'ISSUED'],
}

const fieldError = (field, message) => httpError(422, message, { field, details: { fieldErrors: { [field]: [message] } } })

/** Parse a raw body with zod; throws 422 `{ error:'Validation failed', details }` on failure. */
export function parseOpeningTaxBody(body) {
  const parsed = openingTaxSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw httpError(422, 'Validation failed', { details: parsed.error.flatten() })
  }
  return parsed.data
}

/**
 * Build the TaxEntry fields for an opening balance.
 * @param {object} input     parseOpeningTaxBody() output
 * @param {object} ctx
 * @param {object} ctx.settings  finance settings (goLiveDate, fiscalYearStartMonth)
 * @param {object} [ctx.existing] the stored entry when editing (keeps a masked TIN)
 * @returns {object} TaxEntry fields (date as Date, period/fiscalYear/claimDeadline filled)
 */
export function buildOpeningTaxEntry(input, { settings, existing = null }) {
  const goLive = settings.goLiveDate
  if (!goLive) throw httpError(409, 'Set the go-live date (step 1) before entering opening balances')
  const asOf = addDays(goLive, -1)
  const t = input.entryType

  if (input.date > asOf) {
    throw fieldError('date', `Opening balances must be dated before go-live — on or before ${dayKeyLabel(asOf)}`)
  }
  if (input.date < '2000-01-01') throw fieldError('date', 'Date is too far in the past')

  const amount = round2(input.amount ?? 0)
  const sdAmount = t === 'VAT_BALANCE_BF' ? round2(input.sdAmount ?? 0) : 0
  if (amount + sdAmount <= 0.005) throw fieldError('amount', 'Enter an amount greater than zero')

  // Party
  const partyName = input.partyName ?? null
  if (PARTY_REQUIRED[t] && !partyName) throw fieldError('partyName', PARTY_REQUIRED[t])

  let partyBin = null
  if (input.partyBin && ['INPUT_VAT', 'VDS_RECEIVABLE', 'VDS_PAYABLE', 'TDS_RECEIVABLE', 'TDS_PAYABLE'].includes(t)) {
    if (!isValidBin(input.partyBin)) throw fieldError('partyBin', 'BIN is 9 or 13 digits, e.g. 000123456-0101')
    partyBin = normalizeBin(input.partyBin)
  }

  let partyTin = null
  if (input.partyTin && ['TDS_RECEIVABLE', 'TDS_PAYABLE'].includes(t)) {
    if (isMaskedValue(input.partyTin)) {
      if (!existing) throw fieldError('partyTin', 'Re-enter the full TIN')
      partyTin = existing.partyTin ?? null
    } else {
      if (!isValidTin(input.partyTin)) throw fieldError('partyTin', 'TIN is 12 digits')
      partyTin = normalizeTin(input.partyTin)
    }
  }

  const baseAmount = ['ADVANCE_TAX', 'VAT_BALANCE_BF'].includes(t) ? 0 : round2(input.baseAmount ?? 0)
  if (['INPUT_VAT', 'VDS_RECEIVABLE', 'VDS_PAYABLE'].includes(t) && baseAmount > 0 && amount > baseAmount + 0.005) {
    throw fieldError('amount', 'VAT cannot be more than the value it was charged on')
  }
  if (['TDS_RECEIVABLE', 'TDS_PAYABLE'].includes(t) && baseAmount > 0 && amount > baseAmount + 0.005) {
    throw fieldError('amount', 'Tax deducted cannot be more than the payment amount')
  }

  const startDay = parseDhakaDay(input.date)
  const date = startDay.start
  const period = taxPeriodOf(date)
  const fiscalYear = fiscalYearOf(date, settings.fiscalYearStartMonth)

  const out = {
    entryType:    t,
    isOpening:    true,
    date,
    period,
    fiscalYear,
    amount,
    sdAmount,
    baseAmount,
    rate:         null,
    treatment:    null,
    creditable:   null,
    claimDeadline: null,
    balanceSide:  null,
    section:      null,
    payeeType:    null,
    partyType:    null,
    partyName:    t === 'ADVANCE_TAX' || t === 'VAT_BALANCE_BF' ? null : partyName,
    partyBin,
    partyTin,
    documentNo:   input.documentNo ?? null,
    documentDate: input.documentDate ? parseDhakaDay(input.documentDate).start : null,
    notes:        input.notes ?? null,
    certificate:  { status: 'NOT_REQUIRED', number: null, date: null, url: existing?.certificate?.url ?? null },
    deposit:      { status: 'NOT_REQUIRED', challanNo: null, date: null, depositEntryId: null, accountCode: null },
  }

  if (input.rate !== undefined && input.rate !== null) out.rate = Number(input.rate)
  else if (baseAmount > 0 && amount > 0 && t !== 'ADVANCE_TAX') out.rate = Math.round((amount / baseAmount) * 10000) / 100

  switch (t) {
    case 'VAT_BALANCE_BF': {
      out.balanceSide = input.balanceSide ?? 'CREDIT'
      out.rate = null
      break
    }
    case 'INPUT_VAT':
    case 'VDS_RECEIVABLE': {
      out.claimDeadline = addPeriods(period, CLAIM_WINDOW_PERIODS)
      const goLivePeriod = taxPeriodOf(goLive)
      if (out.claimDeadline < goLivePeriod) {
        throw fieldError('date', t === 'INPUT_VAT'
          ? `This bill's VAT could only be claimed up to the ${periodLabel(out.claimDeadline)} return — it can no longer be claimed, so it is not an opening balance`
          : `This VDS could only be adjusted up to the ${periodLabel(out.claimDeadline)} return — it can no longer be claimed`)
      }
      if (t === 'INPUT_VAT') {
        out.treatment = input.treatment ?? 'STANDARD'
        out.creditable = true
      } else if (input.treatment) {
        out.treatment = input.treatment
      }
      break
    }
    case 'TDS_RECEIVABLE':
    case 'TDS_PAYABLE': {
      out.section = input.section ? String(input.section).trim().toUpperCase() : null
      if (t === 'TDS_PAYABLE') {
        if (!out.section) throw fieldError('section', 'Choose the TDS section the tax was deducted under')
        out.payeeType = input.payeeType ?? 'COMPANY'
      }
      break
    }
    default:
      break
  }

  if (DEFAULT_PARTY_TYPE[t]) out.partyType = input.partyType ?? DEFAULT_PARTY_TYPE[t]

  // Certificates
  if (CERT_STATUSES[t]) {
    const allowed = CERT_STATUSES[t]
    const cert = input.certificate ?? {}
    // No explicit status: a certificate number on a receivable means it was received.
    const implied = !cert.status && cert.number && (t === 'VDS_RECEIVABLE' || t === 'TDS_RECEIVABLE') ? 'RECEIVED' : 'PENDING'
    const status = cert.status && allowed.includes(cert.status) ? cert.status : implied
    if (cert.status && !allowed.includes(cert.status) && cert.status !== 'NOT_REQUIRED') {
      throw fieldError('certificate.status', `Certificate status must be ${allowed.join(' or ')}`)
    }
    let certDate = null
    if (status !== 'PENDING') {
      certDate = cert.date ?? null
      // A certificate already received / issued cannot carry a future date (same rule
      // as the tax ledger). Checked on the date entered, before the fallback below.
      if (certDate && certDate > dhakaDayKey(new Date())) {
        throw fieldError('certificate.date', 'The certificate date cannot be in the future')
      }
      if (!certDate && t === 'VDS_RECEIVABLE') {
        throw fieldError('certificate.date', 'Enter the date on the Mushak-6.6 — the VDS is claimable from that tax period')
      }
      // A certificate can arrive (or be issued) after go-live — any date from the entry up to today is fine.
      if (!certDate) certDate = input.date
      if (certDate < input.date) {
        throw fieldError('certificate.date', 'The certificate cannot be dated before the deduction')
      }
    }
    out.certificate = {
      status,
      number: cert.number ?? null,
      date:   certDate ? parseDhakaDay(certDate).start : null,
      url:    existing?.certificate?.url ?? null,
    }
  }

  // Payables still to be paid — same rule as lib/tax/withholding.js:
  //  TDS: deposited by challan (B3's "TDS to deposit").
  //  VDS: a VAT-registered withholder pays it through its return (note 24,
  //       since 1 Jul 2025); an unregistered one deposits it by challan.
  if (t === 'TDS_PAYABLE') {
    out.deposit = { status: 'PENDING', challanNo: null, date: null, depositEntryId: null, accountCode: null }
  } else if (t === 'VDS_PAYABLE') {
    const registered = settings?.vat?.registrationType === 'REGISTERED'
    out.deposit = { status: registered ? 'VIA_RETURN' : 'PENDING', challanNo: null, date: null, depositEntryId: null, accountCode: null }
  }

  // Our own certificate can be ISSUED only when it could be issued from the tax
  // ledger (certificateReadiness): a TDS certificate must show the challan — an
  // opening TDS payable is by definition not yet deposited — and a Mushak-6.6
  // needs the supplier's BIN and the VDS paid (via the return or by challan).
  if (out.certificate?.status === 'ISSUED') {
    if (t === 'TDS_PAYABLE') {
      throw fieldError('certificate.status', 'A TDS certificate is issued only after the TDS is deposited by challan — keep it pending')
    }
    if (t === 'VDS_PAYABLE' && !isValidBin(partyBin)) {
      throw fieldError('certificate.status', 'Supplier BIN missing — no Mushak-6.6 can be issued to an unregistered supplier')
    }
    if (t === 'VDS_PAYABLE' && out.deposit?.status === 'PENDING') {
      throw fieldError('certificate.status', 'Deposit the VDS by challan first — then issue the Mushak-6.6')
    }
  }

  return out
}

/** Fields compared for the audit diff of an edited opening entry. */
export const OPENING_DIFF_FIELDS = [
  'amount', 'sdAmount', 'baseAmount', 'rate', 'date', 'balanceSide', 'treatment', 'section', 'payeeType',
  'partyType', 'partyName', 'partyBin', 'documentNo', 'documentDate', 'notes', 'certificate.status',
  'certificate.number', 'certificate.date',
]
