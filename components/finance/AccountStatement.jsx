'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Download, Loader2, RefreshCw, ShieldCheck, CheckCircle2, Circle, Search, ArrowRight, Receipt, Filter, X, Info,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import Pagination from '@/components/ui/Pagination'
import { cn } from '@/lib/utils'
import {
  dayKeyLabel, addDays, taxPeriodOf, addPeriods, periodFirstDay, periodLastDay, fiscalYearOf, fiscalYearRange, addFiscalYears,
} from '@/lib/finance/fiscal'
import { KIND_LABELS, PAYMENT_CHANNEL_LABELS } from '@/lib/finance/constants'
import { BTN_SECONDARY, formatAmount, fetchJson, todayKey, downloadCsv, plainAmount, dayKeyOf } from './accountTheme'

const PRESETS = [
  { key: 'THIS_MONTH', label: 'This month' },
  { key: 'LAST_MONTH', label: 'Last month' },
  { key: 'LAST_30', label: 'Last 30 days' },
  { key: 'THIS_FY', label: 'This FY' },
  { key: 'LAST_FY', label: 'Last FY' },
  { key: 'ALL', label: 'All time' },
]

function presetRange(key, fyStartMonth = 7) {
  const today = todayKey()
  const period = taxPeriodOf(today)
  switch (key) {
    case 'THIS_MONTH': return { start: periodFirstDay(period), end: today }
    case 'LAST_MONTH': { const p = addPeriods(period, -1); return { start: periodFirstDay(p), end: periodLastDay(p) } }
    case 'LAST_30': return { start: addDays(today, -29), end: today }
    case 'THIS_FY': { const r = fiscalYearRange(fiscalYearOf(today, fyStartMonth), fyStartMonth); return { start: r.startDay, end: today } }
    case 'LAST_FY': { const r = fiscalYearRange(addFiscalYears(fiscalYearOf(today, fyStartMonth), -1, fyStartMonth), fyStartMonth); return { start: r.startDay, end: r.endDay } }
    default: return { start: '', end: '' }
  }
}

const STATUS_ICON = {
  RECONCILED: { Icon: ShieldCheck, cls: 'text-emerald-600', label: 'Reconciled' },
  CLEARED:    { Icon: CheckCircle2, cls: 'text-sky-600', label: 'Cleared' },
  UNCLEARED:  { Icon: Circle, cls: 'text-gray-300', label: 'Not cleared' },
}

const LIMIT = 200

function describe(r) {
  const bits = []
  if (r.kind && r.kind !== 'OPERATING') bits.push(KIND_LABELS[r.kind] ?? r.kind)
  bits.push(r.category)
  if (r.expenseCategory) bits.push(r.expenseCategory)
  return bits.join(' · ')
}

/**
 * Account statement: opening row, transactions with In / Out / running balance and
 * clear status, closing row; date presets, client-side filters and CSV export.
 */
export default function AccountStatement({ account, refreshKey = 0, fyStartMonth = 7 }) {
  const currency = account?.currency ?? 'BDT'
  const [preset, setPreset] = useState('THIS_MONTH')
  const [range, setRange] = useState(() => presetRange('THIS_MONTH', fyStartMonth))
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [direction, setDirection] = useState('all')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [exporting, setExporting] = useState(false)
  const seq = useRef(0)

  const query = useCallback((pg, limit = LIMIT) => {
    const qs = new URLSearchParams({ page: String(pg), limit: String(limit) })
    if (range.start) qs.set('startDate', range.start)
    if (range.end) qs.set('endDate', range.end)
    return `/api/finance/accounts/${account.id}/statement?${qs}`
  }, [account?.id, range.start, range.end])

  const load = useCallback(async () => {
    if (!account?.id) return
    const id = ++seq.current
    setLoading(true)
    try {
      const json = await fetchJson(query(page))
      if (id !== seq.current) return
      setData(json.data)
      setMeta(json.meta)
      setError(null)
    } catch (err) {
      if (id === seq.current) setError(err.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [account?.id, query, page])

  useEffect(() => { load() }, [load, refreshKey])

  const choosePreset = (key) => {
    setPreset(key)
    setRange(presetRange(key, fyStartMonth))
    setPage(1)
  }
  const setStart = (v) => { setPreset('CUSTOM'); setRange(r => ({ ...r, start: v ?? '' })); setPage(1) }
  const setEnd = (v) => { setPreset('CUSTOM'); setRange(r => ({ ...r, end: v ?? '' })); setPage(1) }

  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtersOn = direction !== 'all' || status !== 'all' || q.trim() !== ''
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (direction === 'in' && !(r.inAmount > 0)) return false
      if (direction === 'out' && !(r.outAmount > 0)) return false
      if (status !== 'all' && r.clearStatus !== status) return false
      if (!needle) return true
      return [r.description, r.category, r.expenseCategory, r.reference, r.txnId, r.paidToName, r.vendor, r.counterAccount?.name, r.cheque?.no, plainAmount(r.inAmount || r.outAmount)]
        .some(v => v && String(v).toLowerCase().includes(needle))
    })
  }, [rows, direction, status, q])

  const isFirstPage = !meta || meta.page === 1
  const isLastPage = !meta || meta.page >= (meta.pages || 1)
  const pageIn = shown.reduce((s, r) => s + (r.excluded ? 0 : r.inAmount), 0)
  const pageOut = shown.reduce((s, r) => s + (r.excluded ? 0 : r.outAmount), 0)
  const openingLabelDate = range.start || (data?.openingDate ? dayKeyOf(data.openingDate) : '')

  async function exportCsv() {
    setExporting(true)
    try {
      const all = []
      let pg = 1
      let pages = 1
      let head = null
      do {
        const json = await fetchJson(query(pg, 1000))
        head = head ?? json.data
        all.push(...json.data.rows)
        pages = json.meta?.pages || 1
        pg += 1
      } while (pg <= pages && pg <= 50)
      const out = [[
        'Date', 'Txn ID', 'Description', 'Category', 'Kind', 'Channel', 'Reference', 'Counter account / party',
        `In (${currency})`, `Out (${currency})`, `Balance (${currency})`, 'Status', 'Note',
      ]]
      out.push([openingLabelDate, '', 'Opening balance', '', '', '', '', '', '', '', plainAmount(head.openingBalance), '', ''])
      for (const r of all) {
        out.push([
          dayKeyOf(r.date), r.txnId ?? '', r.description ?? '', [r.category, r.expenseCategory].filter(Boolean).join(' / '),
          KIND_LABELS[r.kind] ?? r.kind ?? '', r.channel ? (PAYMENT_CHANNEL_LABELS[r.channel] ?? r.channel) : '', r.reference ?? '',
          r.counterAccount?.name ?? r.paidToName ?? r.vendor ?? '',
          r.inAmount ? plainAmount(r.inAmount) : '', r.outAmount ? plainAmount(r.outAmount) : '', r.excluded ? '' : plainAmount(r.running),
          r.clearStatus ?? '', r.excluded ? 'Before opening date — not in balance' : (r.cheque?.no ? `Cheque ${r.cheque.no}` : ''),
        ])
      }
      out.push([range.end || todayKey(), '', 'Closing balance', '', '', '', '', '', plainAmount(head.totals?.inflow), plainAmount(head.totals?.outflow), plainAmount(head.closingBalance), '', ''])
      const safe = String(account.name).replace(/[^\w-]+/g, '_')
      downloadCsv(`statement-${safe}-${range.start || 'start'}-to-${range.end || todayKey()}.csv`, out)
      toast.success(`Exported ${all.length} row${all.length === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Range + filters */}
      <div className="bg-white border border-gray-100 rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => choosePreset(p.key)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-medium border transition-colors', preset === p.key ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="grid grid-cols-2 gap-2 lg:w-80">
            <DatePicker value={range.start || null} onChange={setStart} placeholder="From" size="sm" />
            <DatePicker value={range.end || null} onChange={setEnd} placeholder="To" size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search this page…" className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <select value={direction} onChange={e => setDirection(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" aria-label="Direction">
              <option value="all">In &amp; out</option>
              <option value="in">Money in</option>
              <option value="out">Money out</option>
            </select>
            <select value={status} onChange={e => setStatus(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" aria-label="Clear status">
              <option value="all">Any status</option>
              <option value="UNCLEARED">Not cleared</option>
              <option value="CLEARED">Cleared</option>
              <option value="RECONCILED">Reconciled</option>
            </select>
            {filtersOn && (
              <button type="button" onClick={() => { setDirection('all'); setStatus('all'); setQ('') }} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
            <div className="flex items-center gap-2 lg:ml-auto">
              <button type="button" onClick={load} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50" aria-label="Refresh">
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              </button>
              <button type="button" className={cn(BTN_SECONDARY, 'py-1.5')} onClick={exportCsv} disabled={exporting || !data}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} CSV
              </button>
            </div>
          </div>
        </div>
        {filtersOn && (
          <p className="flex items-center gap-1.5 text-[11px] text-gray-500"><Filter className="w-3 h-3" /> Filtered view of this page — the balance column still reflects every transaction.</p>
        )}
      </div>

      {/* Summary strip */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: `Opening${openingLabelDate ? ` · ${dayKeyLabel(openingLabelDate)}` : ''}`, value: data.openingBalance },
            { label: 'Money in', value: data.totals?.inflow, cls: 'text-emerald-700' },
            { label: 'Money out', value: data.totals?.outflow, cls: 'text-gray-900' },
            { label: `Closing${range.end ? ` · ${dayKeyLabel(range.end)}` : ''}`, value: data.closingBalance, strong: true },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-100 rounded-xl px-4 py-3">
              <p className="text-[11px] text-gray-500 truncate">{s.label}</p>
              <p className={cn('text-base tabular-nums', s.strong ? 'font-bold' : 'font-semibold', s.value < -0.004 ? 'text-red-600' : (s.cls ?? 'text-gray-900'))}>
                {formatAmount(s.value ?? 0, currency)}
              </p>
            </div>
          ))}
        </div>
      )}

      {data?.preOpeningCount > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          {data.preOpeningCount} transaction{data.preOpeningCount === 1 ? ' is' : 's are'} dated before this account's opening date ({dayKeyLabel(data.openingDate)}). They are shown greyed out and are not part of the balance — that money is already in the opening balance.
        </p>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {error ? (
          <div className="px-4 py-10 text-center text-sm text-red-600">{error} <button type="button" onClick={load} className="ml-2 underline">Retry</button></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-gray-50/80">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5 font-medium w-28">Date</th>
                  <th className="px-4 py-2.5 font-medium">Details</th>
                  <th className="px-4 py-2.5 font-medium w-32">Channel</th>
                  <th className="px-4 py-2.5 font-medium text-right w-32">In</th>
                  <th className="px-4 py-2.5 font-medium text-right w-32">Out</th>
                  <th className="px-4 py-2.5 font-medium text-right w-36">Balance</th>
                  <th className="px-3 py-2.5 font-medium text-center w-12"><span className="sr-only">Status</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data && isFirstPage && (
                  <tr className="bg-gray-50/40">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{openingLabelDate ? dayKeyLabel(openingLabelDate) : '—'}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-700" colSpan={4}>Opening balance</td>
                    <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap', data.openingBalance < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(data.openingBalance, currency)}</td>
                    <td />
                  </tr>
                )}
                {loading && !data && [0, 1, 2, 3, 4].map(i => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 rounded bg-gray-100 animate-pulse" /></td></tr>
                ))}
                {data && shown.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">
                    {rows.length === 0 ? 'No transactions in this period.' : 'No transactions on this page match the filters.'}
                  </td></tr>
                )}
                {shown.map(r => {
                  const st = STATUS_ICON[r.clearStatus] ?? STATUS_ICON.UNCLEARED
                  return (
                    <tr key={r.id} className={cn('align-top hover:bg-gray-50/60', r.excluded && 'opacity-50')}>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{dayKeyLabel(r.date)}</td>
                      <td className="px-4 py-2.5">
                        <p className="text-gray-900">{r.description}</p>
                        <p className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span>{describe(r)}</span>
                          {r.txnId && <span className="font-mono text-gray-400">{r.txnId}</span>}
                          {r.counterAccount && (
                            <span className="inline-flex items-center gap-1 text-gray-600">
                              {r.type === 'EXPENSE' ? <>to <ArrowRight className="w-3 h-3" /></> : <>from</>} {r.counterAccount.name}
                            </span>
                          )}
                          {!r.counterAccount && (r.paidToName || r.vendor) && <span>{r.type === 'EXPENSE' ? 'Paid to' : 'From'} {r.paidToName || r.vendor}</span>}
                          {r.cheque?.no && <span>Chq {r.cheque.no}</span>}
                          {r.reference && <span className="truncate max-w-[220px]" title={r.reference}>Ref {r.reference}</span>}
                          {r.tax && (r.tax.vdsBDT > 0 || r.tax.tdsBDT > 0) && (
                            <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 text-violet-700">
                              <Receipt className="w-3 h-3" />
                              {[r.tax.vdsBDT > 0 && `VDS ${formatAmount(r.tax.vdsBDT, 'BDT')}`, r.tax.tdsBDT > 0 && `TDS/AIT ${formatAmount(r.tax.tdsBDT, 'BDT')}`].filter(Boolean).join(' · ')}
                            </span>
                          )}
                          {r.reversalOf && <span className="rounded bg-amber-50 px-1.5 text-amber-700">Reversal</span>}
                          {r.excluded && <span className="rounded bg-amber-50 px-1.5 text-amber-700">Before opening date</span>}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{r.channel ? (PAYMENT_CHANNEL_LABELS[r.channel] ?? r.channel) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-emerald-700">{r.inAmount > 0 ? formatAmount(r.inAmount, currency) : ''}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-900">{r.outAmount > 0 ? formatAmount(r.outAmount, currency) : ''}</td>
                      <td className={cn('px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-medium', r.running < -0.004 ? 'text-red-600' : 'text-gray-800')}>
                        {r.excluded ? '—' : formatAmount(r.running, currency)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span title={`${st.label}${r.clearedDate ? ` · ${dayKeyLabel(r.clearedDate)}` : ''}`}><st.Icon className={cn('w-4 h-4 inline', st.cls)} /></span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {data && (
                <tfoot className="border-t border-gray-100">
                  {filtersOn && (
                    <tr className="text-xs text-gray-500">
                      <td className="px-4 py-2" colSpan={3}>Shown rows on this page</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatAmount(pageIn, currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatAmount(pageOut, currency)}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                  {isLastPage && (
                    <tr className="bg-gray-50/60">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{range.end ? dayKeyLabel(range.end) : 'Today'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900" colSpan={2}>Closing balance</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-medium whitespace-nowrap">{formatAmount(data.totals?.inflow ?? 0, currency)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">{formatAmount(data.totals?.outflow ?? 0, currency)}</td>
                      <td className={cn('px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap', data.closingBalance < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(data.closingBalance, currency)}</td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
        )}
        {meta && meta.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-50"><Pagination meta={meta} onPageChange={setPage} /></div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
        {Object.entries(STATUS_ICON).map(([k, s]) => (
          <span key={k} className="inline-flex items-center gap-1"><s.Icon className={cn('w-3.5 h-3.5', s.cls)} /> {s.label}</span>
        ))}
      </div>
    </div>
  )
}
