export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry, TaxFiling } from '@/models'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { getFinanceSettings, getCompanyProfile } from '@/lib/finance/settings'
import { complianceCalendar, cashPaymentRatio } from '@/lib/tax/engine'
import { computeVatReturn } from '@/lib/tax/vatReturn'
import { round2, isValidBin, isValidTin } from '@/lib/tax/catalog'
import {
  isPeriod, taxPeriodOf, addPeriods, periodRange, periodLabel, fiscalYearOf, advanceTaxDueDates,
  addDays, dayKeyLabel,
} from '@/lib/finance/fiscal'
import {
  errorResponse, todayKey, daysBetween, tdsDueInfo, vdsDepositDueInfo, returnPeriodOf, num, moneySum, depositBalanceOf,
} from '../entries/_lib/common'
import { certificateDue, certificateReadiness } from '../entries/_lib/certificates'
import { defaultWhtQuarter, computeWithholdingReturn } from '../entries/_lib/withholdingReturn'
import { formatMoney } from '@/lib/currencies'

const FILED = ['FILED', 'AMENDED']
const tk = (n) => formatMoney(round2(n), 'BDT')
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function vatBlock(result, currentPeriod, today) {
  if (!result) return null
  const s = result.summary ?? {}
  const filed = !!result.filing && FILED.includes(result.filing.status)
  return {
    key: result.periodKey,
    start: result.start,
    end: result.end,
    label: result.label,
    dueDate: result.dueDate,
    daysLeft: daysBetween(today, result.dueDate),
    overdue: !filed && result.dueDate < today,
    provisional: result.end >= currentPeriod,
    filing: result.filing,
    filed,
    taxableSales: s.taxableSales ?? 0,
    output: s.output ?? 0,
    input: s.input ?? 0,
    increasing: s.increasing ?? 0,
    decreasing: s.decreasing ?? 0,
    netPayable: s.netPayable ?? 0,
    previousCredit: s.previousCredit ?? 0,
    estimatedPayable: s.estimatedPayable ?? 0,
    deposits: s.deposits ?? 0,
    balanceDue: s.balanceDue ?? 0,
    closingBalance: s.closingBalance ?? 0,
    // Note 65: what is carried to the next return after any refund request (67).
    carryForward: result.carryForward ?? s.closingBalance ?? 0,
    warnings: (result.warnings ?? []).filter(w => ['danger', 'warning'].includes(w.level)).slice(0, 8)
      .map(w => ({ level: w.level, code: w.code, message: w.message })),
  }
}

async function safeVat(start, end) {
  try {
    return { result: await computeVatReturn({ start, end }), error: null }
  } catch (err) {
    if (err?.status && err.status < 500) return { result: null, error: err.message }
    console.error('[GET /api/tax/summary] computeVatReturn', err)
    return { result: null, error: 'The VAT return could not be computed' }
  }
}

const INSTALMENT_NOTE_RE = /\bInstalment ([1-4]) of 4\b/

/**
 * Which s.155 advance-tax instalments (1–4) are paid, per income year. A challan
 * counts for the instalment it names (`instalment`; rows saved before that field
 * existed — no field at all — their "Instalment N of 4" note). Challans that name none — opening
 * balances, untagged payments — fill the earliest instalments still open.
 * @returns {Map<string, Set<number>>}
 */
function advanceInstalmentsPaid(rows, fys) {
  // The stored field wins, including an explicit null ("Not stated", e.g. cleared in
  // the entry's edit form); only rows without the field (legacy) fall back to the note.
  const tagOf = (r) => (r.instalment !== undefined
    ? (Number(r.instalment) || null)
    : (Number(INSTALMENT_NOTE_RE.exec(r.notes ?? '')?.[1]) || null))
  const out = new Map()
  for (const f of fys) {
    const mine = rows.filter(r => r.fiscalYear === f)
    const done = new Set(mine.map(tagOf).filter(Boolean))
    let untagged = mine.filter(r => !tagOf(r)).length
    for (let i = 1; i <= 4 && untagged > 0; i++) {
      if (!done.has(i)) { done.add(i); untagged -= 1 }
    }
    out.set(f, done)
  }
  return out
}

const sumGroup = (match) => TaxEntry.aggregate([
  { $match: match },
  { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
]).then(r => ({ count: r[0]?.count ?? 0, amount: round2(r[0]?.amount ?? 0) }))

// GET /api/tax/summary?period=YYYY-MM — tax dashboard
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    const currentPeriod = taxPeriodOf(new Date())
    const period = sp.get('period') || currentPeriod
    if (!isPeriod(period)) return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 })
    if (period > currentPeriod) return NextResponse.json({ error: 'Choose the current or an earlier period' }, { status: 400 })

    await connectDB()
    const [settings, company] = await Promise.all([getFinanceSettings(), getCompanyProfile()])
    const startMonth = settings?.fiscalYearStartMonth ?? 7
    const today = todayKey()
    const fy = fiscalYearOf(periodRange(period).start, startMonth)
    const currentFy = fiscalYearOf(new Date(), startMonth)
    const registered = (settings?.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED'
    const freq = settings?.vat?.returnFrequency ?? 'MONTHLY'
    const expiringBy = addPeriods(currentPeriod, 1)

    // ── VAT returns: the selected period's, and the latest ended one (next due) ──
    const rpSel = returnPeriodOf(period, freq)
    const rpDue = returnPeriodOf(addPeriods(currentPeriod, -1), freq)
    const vatPromise = registered ? safeVat(rpSel.start, rpSel.end) : Promise.resolve({ result: null, error: null })
    const vatDuePromise = registered && rpDue.key !== rpSel.key ? safeVat(rpDue.start, rpDue.end) : vatPromise

    const whtQ = defaultWhtQuarter(startMonth)

    const [
      vatSel, vatDueRaw,
      inputUnclaimed, inputExpiring,
      vdsRecPending, vdsRecReceived, vdsRecPendingRows,
      tdsRec, tdsRecPending,
      tdsPendingRows, tdsCertRows,
      vdsPayCertRows, vdsPayPendingRows,
      advance, wht, cashless,
    ] = await Promise.all([
      vatPromise,
      vatDuePromise,
      sumGroup({ status: 'ACTIVE', entryType: 'INPUT_VAT', creditable: true, claimPeriod: null, $or: [{ claimDeadline: { $gte: currentPeriod } }, { claimDeadline: null }] }),
      TaxEntry.find({ status: 'ACTIVE', entryType: 'INPUT_VAT', creditable: true, claimPeriod: null, claimDeadline: { $gte: currentPeriod, $lte: expiringBy } })
        .sort({ claimDeadline: 1, date: 1 }).limit(50).select('entryNo partyName documentNo amount claimDeadline period date').lean(),
      sumGroup({ status: 'ACTIVE', entryType: 'VDS_RECEIVABLE', 'certificate.status': 'PENDING', claimPeriod: null, $or: [{ claimDeadline: { $gte: currentPeriod } }, { claimDeadline: null }] }),
      sumGroup({ status: 'ACTIVE', entryType: 'VDS_RECEIVABLE', 'certificate.status': 'RECEIVED', claimPeriod: null }),
      TaxEntry.find({ status: 'ACTIVE', entryType: 'VDS_RECEIVABLE', 'certificate.status': 'PENDING', claimPeriod: null })
        .select('amount claimDeadline period claimPeriod certificate entryType status').lean(),
      sumGroup({ status: 'ACTIVE', entryType: 'TDS_RECEIVABLE', fiscalYear: fy }),
      sumGroup({ status: 'ACTIVE', entryType: 'TDS_RECEIVABLE', fiscalYear: fy, 'certificate.status': 'PENDING' }),
      TaxEntry.find({ status: 'ACTIVE', entryType: 'TDS_PAYABLE', 'deposit.status': 'PENDING' })
        .select('date period amount payeeType partyName deposit').sort({ date: 1 }).lean(),
      TaxEntry.find({ status: 'ACTIVE', entryType: 'TDS_PAYABLE', 'certificate.status': 'PENDING' })
        .select('entryType date period amount deposit certificate status partyBin filingId').lean(),
      TaxEntry.find({ status: 'ACTIVE', entryType: 'VDS_PAYABLE', 'certificate.status': 'PENDING' })
        .select('entryType date period amount deposit certificate status partyBin filingId').lean(),
      TaxEntry.find({ status: 'ACTIVE', entryType: 'VDS_PAYABLE', 'deposit.status': 'PENDING' })
        .select('date amount deposit').lean(),
      TaxEntry.aggregate([
        { $match: { status: 'ACTIVE', entryType: 'ADVANCE_TAX', fiscalYear: { $in: [...new Set([fy, currentFy])] } } },
        { $group: { _id: '$fiscalYear', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      computeWithholdingReturn(whtQ).catch(err => { console.error('[GET /api/tax/summary] wht', err); return null }),
      cashPaymentRatio(fy).catch(err => { console.error('[GET /api/tax/summary] cash ratio', err); return null }),
    ])

    const vat = vatBlock(vatSel.result, currentPeriod, today)
    const vatDueBlock = vatBlock(vatDueRaw.result, currentPeriod, today)
    const vatDue = vatDueBlock && !vatDueBlock.provisional && !vatDueBlock.filed ? vatDueBlock : null

    // ── TDS payable (part-paid deductions count with what is still owed) ──
    const tdsRows = tdsPendingRows.map(r => ({ ...r, balance: depositBalanceOf(r), due: tdsDueInfo(r, today) }))
    const tdsOverdue = tdsRows.filter(r => r.due.overdue)
    const tdsSoon = tdsRows.filter(r => !r.due.overdue && r.due.daysLeft !== null && r.due.daysLeft <= 7)
    // s.143: 2% per month (or part) of delay on undeposited TDS.
    const interestEstimate = round2(tdsOverdue.reduce((s, r) => s + num(r.balance) * 0.02 * Math.max(1, Math.ceil(Math.abs(r.due.daysLeft) / 30)), 0))
    const tdsCertReady = tdsCertRows.filter(r => certificateReadiness(r, settings).ready)
    const tdsCertOverdue = tdsCertRows.filter(r => certificateDue(r, settings, today)?.overdue)

    // ── VDS payable ──
    const vdsCertReady = vdsPayCertRows.filter(r => certificateReadiness(r, settings).ready)
    const vdsCertOverdue = vdsPayCertRows.filter(r => certificateDue(r, settings, today)?.overdue)
    const vdsDepRows = vdsPayPendingRows.map(r => ({ ...r, balance: depositBalanceOf(r), due: vdsDepositDueInfo(r, today) }))
    const vdsDepOverdue = vdsDepRows.filter(r => r.due.overdue)

    // ── VDS receivable windows ──
    const vdsRecExpiring = vdsRecPendingRows.filter(r => {
      const d = certificateDue(r, settings, today)
      return d?.period && !d.overdue && d.period <= expiringBy
    })
    const vdsRecExpired = vdsRecPendingRows.filter(r => certificateDue(r, settings, today)?.overdue)

    // ── Advance tax ──
    const advFor = (f) => advance.find(a => a._id === f) ?? { count: 0, amount: 0 }
    const advDates = advanceTaxDueDates(fy)
    const advRow = advFor(fy)

    // ── Compliance calendar (overdue-but-open items from the last 60 days + next 90 days) ──
    const rawCal = complianceCalendar({ from: addDays(today, -60), to: addDays(today, 90), settings })
    const vatKeys = rawCal.filter(i => i.kind === 'VAT_RETURN').map(i => i.periodKey)
    const whtKeys = rawCal.filter(i => i.kind === 'WHT_RETURN').map(i => i.periodKey)
    const itrKeys = rawCal.filter(i => i.kind === 'INCOME_TAX_RETURN').map(i => i.periodKey)
    const tdsPeriods = rawCal.filter(i => i.kind === 'TDS_DEPOSIT').map(i => i.periodKey)
    // The current and the selected income years are always loaded too (next-instalment alert, KPI).
    const advFys = [...new Set([...rawCal.filter(i => i.kind === 'ADVANCE_TAX').map(i => i.periodKey), currentFy, fy])]
    const [filings, tdsByPeriod, advByFy] = await Promise.all([
      TaxFiling.find({
        $or: [
          { kind: 'VAT_RETURN', periodKey: { $in: vatKeys } },
          { kind: 'WHT_RETURN', periodKey: { $in: whtKeys } },
          { kind: 'INCOME_TAX_RETURN', periodKey: { $in: itrKeys } },
        ],
      }).select('kind periodKey status').lean(),
      tdsPeriods.length
        ? TaxEntry.aggregate([
            { $match: { status: 'ACTIVE', entryType: 'TDS_PAYABLE', period: { $in: tdsPeriods } } },
            { $group: {
              _id: '$period',
              total: { $sum: 1 },
              pending: { $sum: { $cond: [{ $eq: ['$deposit.status', 'PENDING'] }, 1, 0] } },
              // What is still owed (amount less part payments by challan).
              pendingAmount: { $sum: { $cond: [
                { $eq: ['$deposit.status', 'PENDING'] },
                { $max: [0, { $subtract: ['$amount', { $ifNull: ['$deposit.paidAmount', 0] }] }] },
                0,
              ] } },
            } },
          ])
        : [],
      TaxEntry.find({ status: 'ACTIVE', entryType: 'ADVANCE_TAX', fiscalYear: { $in: advFys } })
        .select('fiscalYear instalment notes').lean(),
    ])
    const filedSet = new Set(filings.filter(f => FILED.includes(f.status)).map(f => `${f.kind}:${f.periodKey}`))
    const tdsMap = new Map(tdsByPeriod.map(r => [r._id, r]))
    const advDone = advanceInstalmentsPaid(advByFy, advFys)
    // Next instalment still to pay this income year (a paid one is skipped).
    const nextAdvance = advanceTaxDueDates(currentFy).find((d, i) => d >= today && !advDone.get(currentFy)?.has(i + 1)) ?? null

    const calendar = []
    for (const it of rawCal) {
      let status = 'PENDING'
      let amount = null
      let href = null
      if (it.kind === 'VAT_RETURN') {
        if (!registered) continue
        status = filedSet.has(`VAT_RETURN:${it.periodKey}`) ? 'DONE' : 'PENDING'
        const [s, e] = it.periodKey.split('..')
        href = `/admin/tax/vat-return?start=${s}&end=${e ?? s}`
        if (vatDue && vatDue.key === it.periodKey) amount = vatDue.balanceDue
        else if (vat && vat.key === it.periodKey) amount = vat.balanceDue
      } else if (it.kind === 'TDS_DEPOSIT') {
        const r = tdsMap.get(it.periodKey)
        if (!r || r.total === 0) status = 'NOTHING_DUE'
        else if (r.pending === 0) status = 'DONE'
        else amount = round2(r.pendingAmount)
        href = '/admin/tax/withholding?tab=tds-deposit'
      } else if (it.kind === 'WHT_RETURN') {
        status = filedSet.has(`WHT_RETURN:${it.periodKey}`) ? 'DONE' : 'PENDING'
        href = `/admin/tax/withholding?tab=wht-return&quarter=${encodeURIComponent(it.periodKey)}`
      } else if (it.kind === 'ADVANCE_TAX') {
        const idx = Number(String(it.key).split('-').pop()) || 1
        status = advDone.get(it.periodKey)?.has(idx) ? 'DONE' : 'PENDING'
        href = '/admin/tax/entries?new=advance'
      } else if (it.kind === 'INCOME_TAX_RETURN') {
        status = filedSet.has(`INCOME_TAX_RETURN:${it.periodKey}`) ? 'DONE' : 'PENDING'
      }
      if (status === 'PENDING' && it.overdue) status = 'OVERDUE'
      if (it.dueDate < today && (status === 'DONE' || status === 'NOTHING_DUE')) continue
      calendar.push({ ...it, status, amount, href })
    }

    // ── Alerts (next actions) ──
    const alerts = []
    const push = (level, message, href = null, action = null) => alerts.push({ level, message, href, action })
    if (registered && !isValidBin(company.bin)) push('danger', 'Company BIN is not set — it must appear on every Mushak form and return.', '/admin/tax/settings', 'Add BIN')
    if (!isValidTin(company.tin)) push('warning', 'Company TIN is not set — it is needed on TDS certificates and challans.', '/admin/tax/settings', 'Add TIN')
    if (tdsOverdue.length) {
      push('danger',
        `${plural(tdsOverdue.length, 'TDS deduction')} (${tk(moneySum(tdsOverdue, 'balance'))}) passed the deposit date — deposit now. Interest of 2% a month applies (≈ ${tk(interestEstimate)} so far).`,
        '/admin/tax/withholding?tab=tds-deposit', 'Deposit now')
    }
    if (tdsSoon.length) {
      const next = tdsSoon.map(r => r.due.dueDate).sort()[0]
      push('warning', `${tk(moneySum(tdsSoon, 'balance'))} of TDS is due for deposit by ${dayKeyLabel(next)} (${plural(daysBetween(today, next), 'day')} left).`, '/admin/tax/withholding?tab=tds-deposit', 'Deposit')
    }
    if (vdsDepOverdue.length) {
      push('danger', `${plural(vdsDepOverdue.length, 'VDS deduction')} (${tk(moneySum(vdsDepOverdue, 'balance'))}) should have been deposited within 15 days of payment.`, '/admin/tax/withholding?tab=vds-issue', 'Deposit VDS')
    }
    if (vatDue) {
      if (vatDue.overdue) {
        push('danger', `VAT return for ${vatDue.label} was due on ${dayKeyLabel(vatDue.dueDate)} and is not filed — interest and a late-filing penalty apply.`, `/admin/tax/vat-return?start=${vatDue.start}&end=${vatDue.end}`, 'Open return')
      } else if (vatDue.daysLeft !== null && vatDue.daysLeft <= 10) {
        push('warning', `VAT return for ${vatDue.label} is due in ${plural(vatDue.daysLeft, 'day')} (${dayKeyLabel(vatDue.dueDate)}) — ${vatDue.balanceDue > 0 ? `${tk(vatDue.balanceDue)} still to pay` : 'nothing left to pay'}.`, `/admin/tax/vat-return?start=${vatDue.start}&end=${vatDue.end}`, 'Prepare return')
      }
    }
    if (wht?.quarter && !wht.filing?.status) {
      const q = wht.quarter
      if (q.overdue) push('danger', `Withholding tax return for ${q.label} was due on ${dayKeyLabel(q.dueDate)} and is not recorded as filed.`, `/admin/tax/withholding?tab=wht-return&quarter=${q.key}`, 'Open return')
      else if (q.ended && q.daysLeft !== null && q.daysLeft <= 15) push('warning', `Withholding tax return for ${q.label} is due in ${plural(q.daysLeft, 'day')} (${dayKeyLabel(q.dueDate)}).`, `/admin/tax/withholding?tab=wht-return&quarter=${q.key}`, 'Prepare')
    }
    if (inputExpiring.length) {
      push('warning', `${plural(inputExpiring.length, 'input VAT credit')} (${tk(moneySum(inputExpiring))}) ${inputExpiring.length === 1 ? 'expires' : 'expire'} by ${periodLabel(expiringBy)} — claim them in the next return.`, '/admin/tax/registers?type=purchases', 'Review')
    }
    if (vdsRecExpiring.length) {
      push('warning', `Collect Mushak-6.6 from customers for ${tk(moneySum(vdsRecExpiring))} of VDS before the claim window closes (${periodLabel(expiringBy)}).`, '/admin/tax/withholding?tab=vds-receivable', 'Record certificates')
    }
    if (vdsRecExpired.length) {
      push('info', `${plural(vdsRecExpired.length, 'VDS deduction')} by customers (${tk(moneySum(vdsRecExpired))}) can no longer be claimed — the 6-period window has closed.`, '/admin/tax/certificates?direction=collect&type=VDS', 'View')
    }
    if (vdsCertOverdue.length) {
      push('warning', `${plural(vdsCertOverdue.length, 'Mushak-6.6 certificate')} to suppliers ${vdsCertOverdue.length === 1 ? 'is' : 'are'} overdue (${tk(moneySum(vdsCertOverdue))} of VDS).`, '/admin/tax/withholding?tab=vds-issue', 'Issue 6.6')
    } else if (vdsCertReady.length) {
      push('info', `${plural(vdsCertReady.length, 'VDS deduction')} ${vdsCertReady.length === 1 ? 'is' : 'are'} ready for a Mushak-6.6 to the supplier.`, '/admin/tax/withholding?tab=vds-issue', 'Issue 6.6')
    }
    if (tdsCertOverdue.length && tdsCertReady.length) {
      push('warning', `${plural(tdsCertReady.length, 'TDS certificate')} can be issued now; ${tdsCertOverdue.length} ${tdsCertOverdue.length === 1 ? 'is' : 'are'} past the two-week deadline.`, '/admin/tax/withholding?tab=tds-certs', 'Issue certificates')
    } else if (tdsCertReady.length) {
      push('info', `${plural(tdsCertReady.length, 'deposited TDS deduction')} still need a certificate for the payee.`, '/admin/tax/withholding?tab=tds-certs', 'Issue certificates')
    }
    if (cashless?.overThreshold) {
      push('warning', `${round2(cashless.ratioPct)}% of this income year's payments were in cash (limit ${cashless.thresholdPct}%) — about ${tk(cashless.disallowEstimateBDT)} of expenses may be disallowed.`, null, null)
    }
    if (cashless && cashless.cashSalaryRentBDT > 0.005) {
      push('warning', `${tk(cashless.cashSalaryRentBDT)} of salary or rent was paid in cash this income year — not deductible for income tax (s.55). Pay through a bank.`, null, null)
    }
    if (nextAdvance && daysBetween(today, nextAdvance) <= 15) {
      push('info', `Advance income tax instalment due on ${dayKeyLabel(nextAdvance)} (${plural(daysBetween(today, nextAdvance), 'day')} left).`, '/admin/tax/entries?new=advance', 'Record payment')
    }
    // Return warnings not already covered by the alerts above.
    for (const w of [...(vatDue?.warnings ?? []), ...(vat?.warnings ?? [])]) {
      if (!['INPUT_VAT_EXPIRED', 'RETURN_GAP'].includes(w.code)) continue
      if (alerts.some(a => a.message === w.message)) continue
      push(w.level === 'danger' ? 'danger' : 'warning', w.message, '/admin/tax/vat-return', 'Open return')
    }
    const levelRank = { danger: 0, warning: 1, info: 2 }
    alerts.sort((a, b) => levelRank[a.level] - levelRank[b.level])

    return NextResponse.json({
      data: {
        period,
        periodLabel: periodLabel(period),
        currentPeriod,
        today,
        fiscalYear: fy,
        company: {
          name: company.name || null,
          bin: company.bin || null,
          tin: company.tin || null,
          binValid: isValidBin(company.bin),
          tinValid: isValidTin(company.tin),
        },
        settings: {
          registrationType: settings?.vat?.registrationType ?? 'REGISTERED',
          returnFrequency: freq,
          isVdsEntity: settings?.vat?.isVdsEntity !== false,
          isWithholdingEntity: settings?.incomeTax?.isWithholdingEntity !== false,
          taxLockedUntil: settings?.taxLockedUntil ?? null,
          lockedUntil: settings?.lockedUntil ?? null,
          corporateRate: settings?.incomeTax?.corporateRate ?? null,
          cashlessRate: settings?.incomeTax?.cashlessRate ?? null,
        },
        vat,
        vatError: vatSel.error,
        vatDue,
        inputCredit: {
          unclaimed: inputUnclaimed.amount,
          count: inputUnclaimed.count,
          expiringNextPeriod: {
            by: expiringBy,
            count: inputExpiring.length,
            amount: moneySum(inputExpiring),
            items: inputExpiring.slice(0, 10).map(e => ({ id: String(e._id), entryNo: e.entryNo, partyName: e.partyName, documentNo: e.documentNo, amount: round2(e.amount), claimDeadline: e.claimDeadline })),
          },
        },
        vdsReceivable: {
          pendingCertificates: vdsRecPending,
          received: vdsRecReceived,
          expiring: { count: vdsRecExpiring.length, amount: moneySum(vdsRecExpiring) },
          expired: { count: vdsRecExpired.length, amount: moneySum(vdsRecExpired) },
        },
        tdsReceivable: { fy, amount: tdsRec.amount, count: tdsRec.count, pendingCertificates: tdsRecPending },
        tdsPayable: {
          undeposited: { count: tdsRows.length, amount: moneySum(tdsRows, 'balance') },
          overdue: { count: tdsOverdue.length, amount: moneySum(tdsOverdue, 'balance'), oldestDue: tdsOverdue[0]?.due?.dueDate ?? null, interestEstimate },
          dueSoon: { count: tdsSoon.length, amount: moneySum(tdsSoon, 'balance'), nextDue: tdsSoon.map(r => r.due.dueDate).sort()[0] ?? null },
          nextDue: tdsRows.filter(r => !r.due.overdue).map(r => r.due.dueDate).sort()[0] ?? null,
          certificatesToIssue: { count: tdsCertRows.length, amount: moneySum(tdsCertRows), ready: tdsCertReady.length, overdue: tdsCertOverdue.length },
        },
        vdsPayable: {
          certificatesToIssue: { count: vdsPayCertRows.length, amount: moneySum(vdsPayCertRows), ready: vdsCertReady.length, overdue: vdsCertOverdue.length },
          undeposited: { count: vdsDepRows.length, amount: moneySum(vdsDepRows, 'balance'), overdue: vdsDepOverdue.length },
        },
        advanceTax: {
          fy,
          paid: round2(advRow.amount ?? 0),
          count: advRow.count ?? 0,
          dueDates: advDates,
          instalmentsPaid: [...(advDone.get(fy) ?? [])].sort((a, b) => a - b),
          nextDue: nextAdvance,
          nextDueDaysLeft: nextAdvance ? daysBetween(today, nextAdvance) : null,
        },
        whtReturn: wht
          ? {
              key: wht.quarter.key, label: wht.quarter.label, dueDate: wht.quarter.dueDate, daysLeft: wht.quarter.daysLeft,
              overdue: wht.quarter.overdue, ended: wht.quarter.ended, filing: wht.filing, totals: wht.totals,
            }
          : null,
        calendar,
        cashless,
        alerts,
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/tax/summary]')
  }
}
