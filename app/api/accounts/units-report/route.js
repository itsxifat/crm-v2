export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, Invoice } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { getConfig } from '@/lib/getConfig'
import { parseDhakaDay, dhakaParts } from '@/lib/dhakaTime'
import { BASE_CURRENCY } from '@/lib/currencies'
import { fiscalYearOf, fiscalYearRange } from '@/lib/finance/fiscal'
import { getFinanceSettings } from '@/lib/finance/settings'
import { financeScope } from '@/lib/finance/scope'
import { COMPANY_UNIT, UNASSIGNED, parseUnit, unitOptions, unitLabel } from '@/lib/units'
import { plEffect, plFilter, PL_SELECT, round2 } from '@/app/api/accounts/_lib/pl'
import { unitFilter, inScope, invoiceUnits } from '@/app/api/accounts/_lib/unitScope'

// Invoices whose unpaid balance is a receivable (as in the accounts summary).
const RECEIVABLE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']

// Longest period whose months are all listed (zeros included); a longer one
// lists only the months that have figures.
const MAX_FILLED_MONTHS = 120

const monthKeyOf = (date) => {
  const { year, month } = dhakaParts(date)
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// 'YYYY-MM' keys from `a` to `b` inclusive (empty when a > b).
function monthsBetween(a, b) {
  const out = []
  let [y, m] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  while ((y < by || (y === by && m <= bm)) && out.length <= MAX_FILLED_MONTHS) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

const marginOf = (income, profit) => (income > 0 ? round2((profit / income) * 100) : 0)

// GET /api/accounts/units-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// Income, expense, profit and margin per business unit (each venture, each
// product, Company / shared, and Unassigned for old untagged rows), with a
// month-by-month split and the outstanding receivables of each unit.
//  • Ledger figures follow the P&L rules of _lib/pl.js exactly: OPERATING and
//    NON_CASH rows (legacy rows without a kind count as OPERATING) at their P&L
//    value in BDT, reversals netted on the side they reverse; a foreign row with
//    no BDT figure is counted in `unconvertedCount`, never summed at face value.
//  • `receivable` is what is still owed on issued invoices today (BDT), by the
//    invoice's unit (its own, else its project's venture, else Company). It is
//    not limited to the period.
//  • from / to are Asia/Dhaka days, inclusive; the default is the current
//    fiscal year (finance settings, July–June unless changed).
//  • Active ventures and products are always listed; Company, Unassigned and
//    inactive or unknown units only when they have figures. Users without
//    finance.units.all see only their own units (scope.all = false).
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.reports.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const settings   = await getFinanceSettings().catch(() => null)
    const startMonth = settings?.fiscalYearStartMonth ?? 7
    const fy   = fiscalYearRange(fiscalYearOf(new Date(), startMonth), startMonth)
    const from = (searchParams.get('from') ?? searchParams.get('startDate'))?.trim() || fy.startDay
    const to   = (searchParams.get('to')   ?? searchParams.get('endDate'))?.trim()   || fy.endDay
    const fromDay = parseDhakaDay(from)
    const toDay   = parseDhakaDay(to)
    if (!fromDay || !toDay) return NextResponse.json({ error: 'Invalid date — use YYYY-MM-DD' }, { status: 400 })
    if (from > to) return NextResponse.json({ error: 'The start date is after the end date' }, { status: 400 })

    const [scope, config] = await Promise.all([financeScope(session), getConfig()])

    const [transactions, openInvoices] = await Promise.all([
      Transaction.find(unitFilter({ date: { $gte: fromDay.start, $lt: toDay.next }, ...plFilter() }, scope))
        .select(PL_SELECT).lean(),
      Invoice.find({ status: { $in: RECEIVABLE_STATUSES } })
        .select('total totalBDT paidAmount currency unit projectId projectIds')
        .lean(),
    ])

    // ── Figures per unit (key: the unit, or UNASSIGNED for null) ─────────────
    const byUnit = new Map()
    const bucket = (key) => {
      if (!byUnit.has(key)) byUnit.set(key, { income: 0, expense: 0, receivable: 0, count: 0, unconvertedCount: 0, months: {} })
      return byUnit.get(key)
    }

    for (const tx of transactions) {
      const effect = plEffect(tx)
      if (!effect) continue
      const b = bucket(tx.unit || UNASSIGNED)
      b.count++
      if (effect.unconverted) { b.unconvertedCount++; continue }
      const key = monthKeyOf(tx.date)
      const m = b.months[key] ?? (b.months[key] = { income: 0, expense: 0 })
      if (effect.side === 'INCOME') { b.income += effect.amount; m.income += effect.amount }
      else                          { b.expense += effect.amount; m.expense += effect.amount }
    }

    // Outstanding in the invoice currency, converted to BDT as the summary does
    // (as-is for BDT, via totalBDT / total otherwise); foreign invoices with no
    // BDT figure are listed per currency instead.
    const receivableUnconverted = {}
    if (openInvoices.length) {
      const units = await invoiceUnits(openInvoices)
      for (const inv of openInvoices) {
        const unit = units.get(String(inv._id))
        if (!inScope(scope, unit)) continue
        const total       = Number(inv.total) || 0
        const outstanding = Math.max(0, total - (Number(inv.paidAmount) || 0))
        if (outstanding <= 0) continue
        const cur = inv.currency || BASE_CURRENCY
        if (cur === BASE_CURRENCY) bucket(unit).receivable += outstanding
        else if (Number(inv.totalBDT) > 0 && total > 0) bucket(unit).receivable += outstanding * (Number(inv.totalBDT) / total)
        else receivableUnconverted[cur] = (receivableUnconverted[cur] ?? 0) + outstanding
      }
    }

    // ── Rows: ventures and products in configured order, then units no longer
    // configured, then Company / shared, then Unassigned ──────────────────────
    const known  = unitOptions(config, { includeInactive: true }).map(o => o.value)
    const active = new Set(unitOptions(config).map(o => o.value).filter(v => v !== COMPANY_UNIT))
    const keys   = [...new Set([...known.filter(u => active.has(u) || byUnit.has(u)), ...byUnit.keys()])]
      .filter(u => u === UNASSIGNED ? scope.all : inScope(scope, u))
    const rank   = (u) => (u === UNASSIGNED ? 3e6 : u === COMPANY_UNIT ? 2e6 : known.includes(u) ? known.indexOf(u) : 1e6)
    keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

    // Every month of the period up to the current one (zeros included), plus any
    // month with figures.
    const lastKey    = [monthKeyOf(new Date(toDay.next.getTime() - 1)), monthKeyOf(new Date())].sort()[0]
    const filled     = monthsBetween(monthKeyOf(fromDay.start), lastKey)
    const baseMonths = filled.length > MAX_FILLED_MONTHS ? [] : filled

    const rows = keys.map(u => {
      const b = byUnit.get(u) ?? { income: 0, expense: 0, receivable: 0, count: 0, unconvertedCount: 0, months: {} }
      const income  = round2(b.income)
      const expense = round2(b.expense)
      const profit  = round2(income - expense)
      const monthKeys = [...new Set([...baseMonths, ...Object.keys(b.months)])].sort()
      return {
        unit:       u,
        label:      unitLabel(u === UNASSIGNED ? null : u, config),
        kind:       u === UNASSIGNED ? 'UNASSIGNED' : (parseUnit(u)?.kind ?? 'UNKNOWN'),
        income,
        expense,
        profit,
        margin:     marginOf(income, profit),
        receivable: round2(b.receivable),
        count:      b.count,
        unconvertedCount: b.unconvertedCount,
        months: monthKeys.map(month => {
          const m = b.months[month] ?? { income: 0, expense: 0 }
          const mi = round2(m.income)
          const me = round2(m.expense)
          return { month, income: mi, expense: me, profit: round2(mi - me) }
        }),
      }
    })

    const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0))
    const income  = sum('income')
    const expense = sum('expense')
    const profit  = round2(income - expense)

    return NextResponse.json({
      data: {
        units: rows,
        totals: {
          income,
          expense,
          profit,
          margin:     marginOf(income, profit),
          receivable: sum('receivable'),
          count:      rows.reduce((s, r) => s + r.count, 0),
          unconvertedCount: rows.reduce((s, r) => s + r.unconvertedCount, 0),
          receivableUnconverted: Object.entries(receivableUnconverted)
            .map(([currency, amount]) => ({ currency, amount: round2(amount) })),
        },
        scope:  { all: !!scope.all },
        period: { from, to },
      },
    })
  } catch (err) {
    console.error('[GET /api/accounts/units-report]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
