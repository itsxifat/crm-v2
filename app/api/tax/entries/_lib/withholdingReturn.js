/**
 * app/api/tax/entries/_lib/withholdingReturn.js — SERVER-ONLY quarterly
 * withholding-tax return (s.177, Tofsil-4 style) computed from TDS_PAYABLE entries.
 */

import { TaxEntry, TaxFiling } from '@/models'
import { round2 } from '@/lib/tax/catalog'
import { tdsSectionResolver } from '@/lib/tax/engine'
import { whtQuarterOf, whtQuarterByKey, addPeriods, periodRange, taxPeriodOf } from '@/lib/finance/fiscal'
import {
  httpError, num, str, todayKey, daysBetween, partyKeyOf, depositPaidOf, depositAllocationsOf,
} from './common'

/** The quarter whose return is due next: the previous quarter until its due date, then the current one. */
export function defaultWhtQuarter(startMonth = 7) {
  const cur = whtQuarterOf(new Date(), startMonth)
  const prev = whtQuarterOf(periodRange(addPeriods(cur.start, -1)).start, startMonth)
  return todayKey() <= prev.dueDate ? prev : cur
}

export function resolveWhtQuarter(key, startMonth = 7) {
  if (!key) return defaultWhtQuarter(startMonth)
  const q = whtQuarterByKey(key, startMonth)
  if (!q) throw httpError(400, 'Quarter must look like 2026-27-Q1')
  return q
}

/**
 * Section number and label of a TDS code: the stored TaxCode (custom sections and
 * Tax-settings edits) first, then the catalog. An unknown code falls back to its
 * prefix only when that looks like a section number ('90-X' → '90'), never 's.<word>'.
 */
export function tdsSectionMeta(code, date, resolve) {
  if (!code) return { section: '—', label: 'Section not set', sort: 9999 }
  const row = resolve ? resolve(code, date) : null
  const prefix = String(code).split('-')[0]
  const section = str(row?.section) ?? (/^\d+[A-Z]*$/i.test(prefix) ? prefix : '—')
  const n = parseInt(section, 10)
  return { section, label: str(row?.label) ?? code, sort: Number.isFinite(n) ? n : 9998 }
}

/**
 * @returns {Promise<{ quarter, sections, payees, totals, entryCount, filing }>}
 *   sections: [{ code, section, label, payeeCount, count, base, deducted, deposited, pending, challans[] }]
 *   payees:   [{ code, section, partyName, partyTin, partyType, payeeType, count, base, deducted, deposited, pending, higherRateCount, challans[] }]
 */
export async function computeWithholdingReturn(quarter) {
  const q = quarter
  const entries = await TaxEntry.find({
    status: 'ACTIVE',
    entryType: 'TDS_PAYABLE',
    period: { $gte: q.start, $lte: q.end },
  }).sort({ date: 1, entryNo: 1 }).lean()
  const resolveSection = await tdsSectionResolver(entries.map(e => e.section))

  const sections = new Map()
  const payees = new Map()
  const totals = { count: 0, base: 0, deducted: 0, deposited: 0, pending: 0, payeeCount: 0 }
  const allPayees = new Set()
  const allChallans = new Set()

  for (const e of entries) {
    const code = e.section || null
    const meta = tdsSectionMeta(code, e.date, resolveSection)
    const amount = num(e.amount)
    const base = num(e.baseAmount)
    // Deposited so far — the whole amount, or what part-paying challans covered.
    const paid = depositPaidOf(e)
    const unpaid = Math.max(0, amount - paid)
    const challanNos = depositAllocationsOf(e).map(a => a.challanNo).filter(Boolean)
    const pk = partyKeyOf(e)

    const sKey = code ?? '—'
    if (!sections.has(sKey)) {
      sections.set(sKey, { code, section: meta.section, label: meta.label, sort: meta.sort, payeeKeys: new Set(), count: 0, base: 0, deducted: 0, deposited: 0, pending: 0, challans: new Set() })
    }
    const s = sections.get(sKey)
    s.payeeKeys.add(pk)
    s.count += 1
    s.base += base
    s.deducted += amount
    s.deposited += paid
    s.pending += unpaid
    for (const c of challanNos) s.challans.add(c)

    const pKey = `${sKey}|${pk}`
    if (!payees.has(pKey)) {
      payees.set(pKey, {
        code, section: meta.section, sort: meta.sort,
        partyName: e.partyName || 'Unnamed payee', partyTin: e.partyTin || null, partyType: e.partyType || null,
        payeeType: e.payeeType || null, count: 0, base: 0, deducted: 0, deposited: 0, pending: 0, higherRateCount: 0, challans: new Set(),
      })
    }
    const p = payees.get(pKey)
    if (!p.partyTin && e.partyTin) p.partyTin = e.partyTin
    p.count += 1
    p.base += base
    p.deducted += amount
    p.deposited += paid
    p.pending += unpaid
    if (e.higherRateApplied) p.higherRateCount += 1
    for (const c of challanNos) p.challans.add(c)

    totals.count += 1
    totals.base += base
    totals.deducted += amount
    totals.deposited += paid
    totals.pending += unpaid
    allPayees.add(pk)
    for (const c of challanNos) allChallans.add(c)
  }

  const sectionRows = [...sections.values()]
    .sort((a, b) => a.sort - b.sort || String(a.code).localeCompare(String(b.code)))
    .map(({ payeeKeys, challans, sort, ...s }) => ({
      ...s,
      payeeCount: payeeKeys.size,
      base: round2(s.base), deducted: round2(s.deducted), deposited: round2(s.deposited), pending: round2(s.pending),
      challans: [...challans],
    }))
  const payeeRows = [...payees.values()]
    .sort((a, b) => a.sort - b.sort || String(a.code).localeCompare(String(b.code)) || a.partyName.localeCompare(b.partyName))
    .map(({ challans, sort, ...p }) => ({
      ...p,
      base: round2(p.base), deducted: round2(p.deducted), deposited: round2(p.deposited), pending: round2(p.pending),
      challans: [...challans],
    }))

  const filing = await TaxFiling.findOne({ kind: 'WHT_RETURN', periodKey: q.key }).lean()
  const today = todayKey()
  const filed = !!filing && ['FILED', 'AMENDED'].includes(filing.status)

  return {
    quarter: {
      ...q,
      ended: q.end < taxPeriodOf(new Date()),
      daysLeft: daysBetween(today, q.dueDate),
      overdue: !filed && q.dueDate < today,
    },
    sections: sectionRows,
    payees: payeeRows,
    totals: {
      count: totals.count,
      payeeCount: allPayees.size,
      base: round2(totals.base),
      deducted: round2(totals.deducted),
      deposited: round2(totals.deposited),
      pending: round2(totals.pending),
      challanCount: allChallans.size,
    },
    entryCount: entries.length,
    filing: filing
      ? {
          id: String(filing._id), status: filing.status, returnType: filing.returnType, filedAt: filing.filedAt ?? null,
          acknowledgementNo: filing.acknowledgementNo ?? null, notes: filing.notes ?? null, attachmentUrl: filing.attachmentUrl ?? null,
        }
      : null,
  }
}
