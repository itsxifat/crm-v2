/**
 * app/api/tax/entries/_lib/certificates.js — SERVER-ONLY certificate rules for
 * withholding entries.
 *
 *   COLLECT  VDS_RECEIVABLE (customer's Mushak-6.6) · TDS_RECEIVABLE (customer's TDS certificate)
 *   ISSUE    VDS_PAYABLE (our Mushak-6.6)          · TDS_PAYABLE (our TDS certificate, Tofsil-2)
 */

import mongoose from 'mongoose'
import { TaxEntry, TaxFiling } from '@/models'
import { nextSequence } from '@/lib/sequence'
import { dhakaParts, dhakaDayKey } from '@/lib/dhakaTime'
import { isValidBin } from '@/lib/tax/catalog'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'
import { addDays, addPeriods, periodLabel, taxPeriodOf, tdsDepositDueDate } from '@/lib/finance/fiscal'
import {
  httpError, str, parseDay, todayKey, dayKeyOfDate, daysBetween, partyKeyOf, returnPeriodOf,
} from './common'

export const CERT_DIRECTION = {
  VDS_RECEIVABLE: 'COLLECT',
  TDS_RECEIVABLE: 'COLLECT',
  VDS_PAYABLE:    'ISSUE',
  TDS_PAYABLE:    'ISSUE',
}
export const CERT_ENTRY_TYPES = Object.keys(CERT_DIRECTION)

export const CERT_TYPE_OF = {
  VDS_RECEIVABLE: 'VDS', VDS_PAYABLE: 'VDS', TDS_RECEIVABLE: 'TDS', TDS_PAYABLE: 'TDS',
}

const FILED = ['FILED', 'AMENDED']

/**
 * When the certificate is due (ISSUE) or until when it can still be used (COLLECT).
 * @returns {{ kind:'DATE'|'PERIOD', date?:string, period?:string, label:string, daysLeft:number|null, overdue:boolean }|null}
 */
export function certificateDue(entry, settings, today = todayKey()) {
  const type = entry?.entryType
  const status = entry?.certificate?.status
  if (status === 'NOT_REQUIRED') return null
  if (type === 'TDS_PAYABLE') {
    // Rule 10: within two weeks after the month of deduction.
    const due = tdsDepositDueDate(entry.date)
    if (!due) return null
    return { kind: 'DATE', date: due, label: 'Issue by', daysLeft: daysBetween(today, due), overdue: status === 'PENDING' && due < today }
  }
  if (type === 'VDS_PAYABLE') {
    // Registered withholder: within 3 working days after filing the return of that period.
    // Unregistered: within 3 working days after the deposit (deposit due 15 days after payment).
    const registered = (settings?.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED'
    let base
    if (registered) {
      const rp = returnPeriodOf(entry.period, settings?.vat?.returnFrequency)
      base = rp?.dueDate ?? null
    } else {
      base = dayKeyOfDate(entry.deposit?.date) ?? addDays(dayKeyOfDate(entry.date), 15)
    }
    const due = base ? addDays(base, 3) : null
    if (!due) return null
    return { kind: 'DATE', date: due, label: 'Issue by', daysLeft: daysBetween(today, due), overdue: status === 'PENDING' && due < today }
  }
  if (type === 'VDS_RECEIVABLE') {
    // Claimable as a decreasing adjustment until claimDeadline (6 periods).
    const deadline = entry.claimDeadline || (entry.period ? addPeriods(entry.period, 6) : null)
    if (!deadline || entry.claimPeriod) return null
    const current = taxPeriodOf(new Date())
    return {
      kind: 'PERIOD', period: deadline, label: 'Claim by',
      daysLeft: null, overdue: deadline < current,
      text: `${periodLabel(deadline)} return`,
    }
  }
  return null
}

/**
 * Can our certificate be issued now?
 * @returns {{ ready: boolean, reason: string|null }}
 */
export function certificateReadiness(entry, settings) {
  if (entry?.status !== 'ACTIVE') return { ready: false, reason: 'Entry is void' }
  if (entry.entryType === 'TDS_PAYABLE') {
    if (entry.deposit?.status !== 'DEPOSITED') return { ready: false, reason: 'Deposit the TDS by challan first — the certificate must show the challan' }
    return { ready: true, reason: null }
  }
  if (entry.entryType === 'VDS_PAYABLE') {
    if (!isValidBin(entry.partyBin)) return { ready: false, reason: 'Supplier BIN missing — no Mushak-6.6 can be issued to an unregistered supplier' }
    const ds = entry.deposit?.status
    if (ds === 'PENDING') return { ready: false, reason: 'Deposit the VDS by challan first' }
    const registered = (settings?.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED'
    if (registered && ds === 'VIA_RETURN' && !entry.filingId) {
      return { ready: true, reason: 'Issue within 3 working days after filing the VAT return for this period' }
    }
    return { ready: true, reason: null }
  }
  return { ready: false, reason: 'Not an issued certificate' }
}

/** Is the entry part of a filed (or amended) VAT return? */
export async function filedFilingOf(entry) {
  if (!entry?.filingId) return null
  const filing = await TaxFiling.findById(entry.filingId).select('status periodKey kind').lean()
  return filing && FILED.includes(filing.status) ? filing : null
}

/**
 * Validate a certificate change for one entry and return the $set to apply.
 * input: { status?, number?, date?, url? }  — status defaults to RECEIVED (collect) / ISSUED (issue).
 * ISSUED is refused (409) unless certificateReadiness() allows it — pass the entry
 * as it will be after the save (e.g. with a BIN changed in the same request).
 */
export function planCertificateUpdate(entry, input = {}) {
  const dir = CERT_DIRECTION[entry?.entryType]
  if (!dir) throw httpError(422, 'Certificates apply to VDS / TDS withholding entries only')
  if (entry.status !== 'ACTIVE') throw httpError(409, `${entry.entryNo} is void`)

  const doneStatus = dir === 'COLLECT' ? 'RECEIVED' : 'ISSUED'
  const status = str(input.status)?.toUpperCase() ?? doneStatus
  const allowed = ['PENDING', 'NOT_REQUIRED', doneStatus]
  if (!allowed.includes(status)) {
    throw httpError(422, dir === 'COLLECT'
      ? 'A certificate from a customer can be PENDING, RECEIVED or NOT_REQUIRED'
      : 'A certificate we issue can be PENDING, ISSUED or NOT_REQUIRED')
  }

  const current = entry.certificate ?? {}
  const set = { 'certificate.status': status }

  if (status === doneStatus) {
    // Recording our certificate as issued follows the same rule as issuing it
    // (s.145 / Rule 10: the TDS must be deposited; no 6.6 without the supplier's
    // BIN). Settings only change the informational reason, never `ready`.
    if (dir === 'ISSUE') {
      const rd = certificateReadiness(entry, null)
      if (!rd.ready) throw httpError(409, `${entry.entryNo}: ${rd.reason}`)
    }
    const number = str(input.number) ?? str(current.number)
    if (!number) throw httpError(422, 'Enter the certificate number')
    if (number.length > 60) throw httpError(422, 'Certificate number is too long')
    let dateKey = null
    if (input.date !== undefined && input.date !== null && input.date !== '') {
      const d = parseDay(input.date)
      if (!d) throw httpError(422, 'Certificate date must be a valid date (YYYY-MM-DD)')
      dateKey = d.key
    } else if (current.date) {
      dateKey = dayKeyOfDate(current.date)
    }
    if (!dateKey) throw httpError(422, 'Enter the certificate date')
    if (dateKey > todayKey()) throw httpError(422, 'The certificate date cannot be in the future')
    const entryDay = dayKeyOfDate(entry.date)
    if (entryDay && dateKey < entryDay) throw httpError(422, `The certificate date is before the deduction ${entry.entryNo} (${entryDay})`)
    set['certificate.number'] = number
    set['certificate.date'] = parseDay(dateKey).start
  } else {
    if (entry.entryType === 'VDS_RECEIVABLE' && entry.claimPeriod) {
      throw httpError(409, `${entry.entryNo} was already claimed in the VAT return for ${periodLabel(entry.claimPeriod)} — its certificate cannot be removed`)
    }
    set['certificate.number'] = null
    set['certificate.date'] = null
  }

  if (input.url !== undefined) {
    const url = str(input.url)
    // A new link must be an uploaded file; the stored one may be sent back unchanged.
    if (url && url !== str(current.url) && (url.length > 500 || !UPLOAD_URL_RE.test(url))) {
      throw httpError(422, 'Attach the certificate copy with the upload button')
    }
    set['certificate.url'] = url
  }
  return set
}

/** Entries must be the same type and the same counter-party to share one certificate. */
export function assertOneCertificateGroup(entries) {
  if (!entries.length) throw httpError(422, 'Select at least one entry')
  const types = new Set(entries.map(e => e.entryType))
  if (types.size > 1) throw httpError(422, 'One certificate covers one kind of deduction — select VDS or TDS entries, not both')
  const parties = new Set(entries.map(partyKeyOf))
  if (parties.size > 1) throw httpError(422, 'One certificate covers one party — select entries of a single customer / supplier')
}

/**
 * Allocate the next certificate number for the Dhaka month of `date`:
 * 'VDS-YYMM-###' or 'TDS-YYMM-###'. Floors at the highest number already used.
 */
export async function nextCertificateNumber(prefixBase, date = new Date()) {
  const { year, month } = dhakaParts(date)
  const prefix = `${prefixBase}-${String(year % 100).padStart(2, '0')}${String(month + 1).padStart(2, '0')}-`
  const used = await TaxEntry.find({ 'certificate.number': { $regex: `^${prefix}[0-9]+$` } }).select('certificate.number').lean()
  const maxUsed = used.reduce((m, d) => Math.max(m, parseInt(String(d.certificate?.number ?? '').slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`taxcert:${prefix}`, maxUsed)
  return `${prefix}${String(seq).padStart(3, '0')}`
}

/**
 * Assign one new certificate number (ISSUED, dated today) to entries that have none.
 * Atomic per entry; if another request numbered any of them meanwhile, the
 * assignment is rolled back and 409 is thrown.
 * @returns {Promise<{ number: string, date: Date }>}
 */
export async function issueCertificateNumber(entries, prefixBase) {
  const now = new Date()
  const number = await nextCertificateNumber(prefixBase, now)
  const ids = entries.map(e => new mongoose.Types.ObjectId(String(e._id)))
  const dateStart = parseDay(dhakaDayKey(now)).start
  const res = await TaxEntry.updateMany(
    { _id: { $in: ids }, status: 'ACTIVE', $or: [{ 'certificate.number': null }, { 'certificate.number': { $exists: false } }, { 'certificate.number': '' }] },
    { $set: { 'certificate.status': 'ISSUED', 'certificate.number': number, 'certificate.date': dateStart } },
  )
  if (res.modifiedCount !== ids.length) {
    await TaxEntry.updateMany(
      { _id: { $in: ids }, 'certificate.number': number },
      { $set: { 'certificate.status': 'PENDING', 'certificate.number': null, 'certificate.date': null } },
    )
    throw httpError(409, 'These entries were numbered by someone else just now — reload and print again')
  }
  return { number, date: dateStart }
}
