/**
 * Server-side helpers shared by the VAT return routes (GET, file, draft, print).
 */

import { TaxFiling } from '@/models'
import { canDo } from '@/lib/rbac'
import { maskIdentity } from '@/lib/pii'
import { isPeriod, taxPeriodOf, addPeriods, periodsBetween, periodLastDay } from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { returnPeriodFor, returnPeriodForRange, recentReturnPeriods } from './layout'

export const FILED_STATUSES = ['FILED', 'AMENDED']
export const MAX_RETURN_PERIODS = 12

export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * Resolve the requested return period from query params:
 *   ?start=YYYY-MM&end=YYYY-MM   explicit range
 *   ?period=YYYY-MM              the return period containing that month
 *   (none)                       the latest ended period not yet filed, else the current one
 * Throws 400 on malformed input.
 */
export async function resolveReturnPeriod(searchParams, frequency) {
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  const period = searchParams.get('period')

  if (start || end) {
    const s = start || end
    const e = end || start
    if (!isPeriod(s) || !isPeriod(e)) throw httpError(400, 'start and end must be tax periods (YYYY-MM)')
    if (s > e) throw httpError(400, 'Start period must not be after the end period')
    if (periodsBetween(s, e).length > MAX_RETURN_PERIODS) throw httpError(400, `Choose at most ${MAX_RETURN_PERIODS} tax periods`)
    return returnPeriodForRange(s, e, frequency)
  }
  if (period) {
    if (!isPeriod(period)) throw httpError(400, 'period must be YYYY-MM')
    return returnPeriodFor(period, frequency)
  }

  const current = returnPeriodFor(taxPeriodOf(new Date()), frequency)
  const previous = returnPeriodFor(addPeriods(current.start, -1), frequency)
  const filed = await TaxFiling.exists({ kind: 'VAT_RETURN', periodKey: previous.key, status: { $in: FILED_STATUSES } })
  return filed ? current : previous
}

/** Picker options: recent return periods merged with every stored VAT filing. */
export async function periodOptions(frequency) {
  const todayKey = dhakaDayKey(new Date())
  const currentPeriod = taxPeriodOf(new Date())
  const recent = recentReturnPeriods(currentPeriod, frequency, 15)
  const filings = await TaxFiling.find({ kind: 'VAT_RETURN' })
    .select('periodKey periodStart periodEnd status returnType filedAt netPayable closingBalance')
    .sort({ periodEnd: -1 }).limit(120).lean()
  const byKey = new Map(filings.map(f => [f.periodKey, f]))

  const list = recent.map(p => ({ ...p }))
  for (const f of filings) {
    if (list.some(p => p.key === f.periodKey) || !isPeriod(f.periodStart) || !isPeriod(f.periodEnd)) continue
    list.push(returnPeriodForRange(f.periodStart, f.periodEnd, frequency))
  }
  list.sort((x, y) => (y.start.localeCompare(x.start)) || (y.end.localeCompare(x.end)))

  return list.map(p => {
    const f = byKey.get(p.key)
    const ended = p.end < currentPeriod
    return {
      ...p,
      status:     f?.status ?? null,
      returnType: f?.returnType ?? null,
      filedAt:    f?.filedAt ?? null,
      netPayable: f && FILED_STATUSES.includes(f.status) ? f.netPayable : null,
      ended,
      isCurrent:  p.start <= currentPeriod && p.end >= currentPeriod,
      overdue:    ended && !FILED_STATUSES.includes(f?.status) && todayKey > p.dueDate,
    }
  })
}

const LINE_GROUPS = ['output', 'input', 'inputNonCreditable', 'increasing', 'decreasing', 'deposits']

/** Mask counter-party TINs in a computed return / snapshot unless the user may see identities. */
export function maskReturnPii(session, result) {
  if (!result || typeof result !== 'object' || canDo(session, 'pii.identity.view')) return result
  const maskRow = (row) => {
    if (row && typeof row === 'object' && row.partyTin) row.partyTin = maskIdentity(row.partyTin)
  }
  for (const g of LINE_GROUPS) (result.lines?.[g] ?? []).forEach(maskRow)
  for (const rows of Object.values(result.noteEntries ?? {})) if (Array.isArray(rows)) rows.forEach(maskRow)
  // Withholding-return (WHT_RETURN) snapshot: one row per payee with its e-TIN.
  if (Array.isArray(result.payees)) result.payees.forEach(maskRow)
  for (const h of result.history ?? []) {
    for (const g of LINE_GROUPS) (h?.lines?.[g] ?? []).forEach(maskRow)
  }
  return result
}

/** TaxFiling (lean) → API summary; `withSnapshot` adds the frozen return. */
export function filingView(f, { withSnapshot = false } = {}) {
  if (!f) return null
  const out = {
    id:                String(f._id ?? f.id),
    kind:              f.kind,
    periodKey:         f.periodKey,
    periodStart:       f.periodStart ?? null,
    periodEnd:         f.periodEnd ?? null,
    fiscalYear:        f.fiscalYear ?? null,
    status:            f.status,
    returnType:        f.returnType ?? null,
    netPayable:        f.netPayable ?? 0,
    closingBalance:    f.closingBalance ?? 0,
    refundRequested:   f.refundRequested ?? 0,
    challans:          (f.challans ?? []).map(c => ({
      challanNo: c.challanNo ?? null, date: c.date ?? null, bank: c.bank ?? null,
      branch: c.branch ?? null, accountCode: c.accountCode ?? null, amount: c.amount ?? 0,
      head: c.head === 'SD' ? 'SD' : 'VAT',
    })),
    filedAt:           f.filedAt ?? null,
    filedBy:           f.filedBy && typeof f.filedBy === 'object' && f.filedBy.name
      ? { id: String(f.filedBy._id), name: f.filedBy.name }
      : (f.filedBy ? { id: String(f.filedBy), name: null } : null),
    acknowledgementNo: f.acknowledgementNo ?? null,
    attachmentUrl:     f.attachmentUrl ?? null,
    notes:             f.notes ?? null,
    historyCount:      Array.isArray(f.snapshot?.history) ? f.snapshot.history.length : 0,
    createdAt:         f.createdAt ?? null,
    updatedAt:         f.updatedAt ?? null,
  }
  if (withSnapshot) out.snapshot = f.snapshot ?? null
  return out
}

/** 'YYYY-MM-DD' last day of a period (for UI hints). */
export function lastDayOf(period) {
  return periodLastDay(period)
}
