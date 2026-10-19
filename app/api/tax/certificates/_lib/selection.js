/**
 * Shared loading / validation of the entries that make up ONE certificate we
 * issue (Mushak-6.6 for VDS_PAYABLE, TDS certificate for TDS_PAYABLE).
 *
 * Used by the print GETs (read-only: draft or reprint) and by the issue POSTs
 * (assign the certificate number), so both apply exactly the same rules.
 * SERVER-ONLY — not a route file.
 */

import { TaxEntry } from '@/models'
import { logActivity } from '@/lib/logActivity'
import {
  assertOneCertificateGroup, certificateReadiness, issueCertificateNumber,
} from '../../entries/_lib/certificates'

const KINDS = {
  VDS: {
    entryType: 'VDS_PAYABLE',
    title:     'Cannot print Mushak-6.6',
    wrongType: (e) => `${e.entryNo} is not VAT deducted from a supplier.`,
  },
  TDS: {
    entryType: 'TDS_PAYABLE',
    title:     'Cannot print the TDS certificate',
    wrongType: (e) => `${e.entryNo} is not tax we deducted from a payee.`,
  },
}

const fail = (status, message, title) => ({ error: { status, message, title: title ?? null } })

/**
 * Load the selected entries and check they form one certificate.
 * @param {string[]} ids  validated ObjectId strings
 * @param {'VDS'|'TDS'} kind
 * @returns {Promise<{ error: { status:number, message:string, title:string|null } }
 *   | { entries: object[], numbers: string[], unnumbered: object[], isSalary: boolean }>}
 */
export async function loadCertificateSelection(ids, kind) {
  const k = KINDS[kind]
  if (!k) return fail(400, 'Unknown certificate kind')
  if (!ids.length) return fail(400, kind === 'VDS' ? 'Select the VDS deductions to include.' : 'Select the TDS deductions to include.')

  const entries = await TaxEntry.find({ _id: { $in: ids } }).sort({ date: 1, entryNo: 1 }).lean()
  if (entries.length !== ids.length) return fail(404, 'Some selected entries were not found.')
  const wrong = entries.find(e => e.entryType !== k.entryType)
  if (wrong) return fail(422, k.wrongType(wrong))
  const voided = entries.find(e => e.status !== 'ACTIVE')
  if (voided) return fail(409, `${voided.entryNo} is void.`)
  try { assertOneCertificateGroup(entries) } catch (err) {
    return fail(422, err.message)
  }

  let isSalary = false
  if (kind === 'TDS') {
    const salaryCount = entries.filter(e => e.section === '86-SALARY').length
    if (salaryCount && salaryCount !== entries.length) {
      return fail(422, 'Salary deductions (s.86, Tofsil-1) and other deductions (Tofsil-2) go on separate certificates.', 'Cannot combine certificates')
    }
    isSalary = salaryCount > 0
  }

  const numbers = [...new Set(entries.map(e => e.certificate?.number).filter(Boolean))]
  const unnumbered = entries.filter(e => !e.certificate?.number)
  if (numbers.length > 1 || (numbers.length === 1 && unnumbered.length)) {
    return fail(409,
      `The selection mixes entries of certificate ${numbers.join(', ')} with ${unnumbered.length ? 'entries not yet certified' : 'another certificate'}. Print each certificate separately.`,
      'Cannot combine certificates')
  }

  return { entries, numbers, unnumbered, isSalary }
}

/** Entries of the selection that are not ready to be certified, with the reason. */
export function certificateBlockers(entries, settings) {
  return entries
    .map(e => ({ e, r: certificateReadiness(e, settings) }))
    .filter(x => !x.r.ready)
}

/** Title used on the HTML message page of a failed print. */
export function printErrorTitle(kind, error) {
  return error?.title || KINDS[kind]?.title || 'Cannot print the certificate'
}

/**
 * Assign the certificate number to a validated, ready, unnumbered selection
 * and log it. The caller checks permission (tax.manage) and readiness.
 * @returns {Promise<{ number: string, date: Date }>}
 */
export async function issueSelection({ entries, kind, isSalary = false, session, request }) {
  const issued = await issueCertificateNumber(entries, kind)
  const form = kind === 'VDS'
    ? 'Mushak-6.6'
    : (isSalary ? 'TDS certificate (salary)' : 'TDS certificate (Tofsil-2)')
  logActivity({
    userId: session.user.id,
    userRole: session.user.role,
    action: 'CREATE',
    entity: 'TAX_ENTRY',
    entityId: String(entries[0]._id),
    changes: JSON.stringify({
      certificate: issued.number,
      form,
      [kind === 'VDS' ? 'supplier' : 'payee']: entries[0].partyName ?? null,
      entries: entries.map(e => e.entryNo),
    }),
    request,
  })
  return issued
}
