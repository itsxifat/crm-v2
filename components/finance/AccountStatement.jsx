'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Download, RefreshCw, ShieldCheck, CheckCircle2, Circle, Search, ArrowRight, Receipt, Filter, X, Info,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import Pagination from '@/components/ui/Pagination'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Input, NativeSelect } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { codeIncludes } from '@/lib/searchMatch'
import {
  dayKeyLabel, addDays, taxPeriodOf, addPeriods, periodFirstDay, periodLastDay, fiscalYearOf, fiscalYearRange, addFiscalYears,
} from '@/lib/finance/fiscal'
import { KIND_LABELS, PAYMENT_CHANNEL_LABELS } from '@/lib/finance/constants'
import { formatAmount, fetchJson, todayKey, downloadCsv, plainAmount, dayKeyOf } from './accountTheme'

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
        .some(v => v && String(v).toLowerCase().includes(needle)) ||
        // Record numbers match with separators ignored (TXN-20261024-0001 = TXN202610240001).
        [r.txnId, r.reference, r.description].some(v => codeIncludes(v, needle))
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
      <Card className="space-y-3 p-3">
        <Tabs
          size="sm"
          value={preset}
          onChange={choosePreset}
          tabs={PRESETS.map(p => ({ value: p.key, label: p.label }))}
        />
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="grid grid-cols-2 gap-2 lg:w-80">
            <DatePicker value={range.start || null} onChange={setStart} placeholder="From" size="sm" />
            <DatePicker value={range.end || null} onChange={setEnd} placeholder="To" size="sm" />
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="h-8 pl-8 text-[13px]" />
            </div>
            <NativeSelect value={direction} onChange={e => setDirection(e.target.value)} className="h-8 w-auto text-[13px]" aria-label="Direction">
              <option value="all">In &amp; out</option>
              <option value="in">Money in</option>
              <option value="out">Money out</option>
            </NativeSelect>
            <NativeSelect value={status} onChange={e => setStatus(e.target.value)} className="h-8 w-auto text-[13px]" aria-label="Clear status">
              <option value="all">Any status</option>
              <option value="UNCLEARED">Not cleared</option>
              <option value="CLEARED">Cleared</option>
              <option value="RECONCILED">Reconciled</option>
            </NativeSelect>
            {filtersOn && (
              <Button variant="ghost" size="xs" onClick={() => { setDirection('all'); setStatus('all'); setQ('') }}>
                <X /> Clear
              </Button>
            )}
            <div className="flex items-center gap-1.5 lg:ml-auto">
              <Button variant="ghost" size="icon-sm" onClick={load} aria-label="Refresh">
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv} loading={exporting} disabled={!data}>
                {!exporting && <Download />} CSV
              </Button>
            </div>
          </div>
        </div>
        {filtersOn && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="size-3.5" /> Filtered view of this page — balances still include every transaction.
          </p>
        )}
      </Card>

      {/* Summary strip */}
      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: `Opening${openingLabelDate ? ` · ${dayKeyLabel(openingLabelDate)}` : ''}`, value: data.openingBalance },
            { label: 'Money in', value: data.totals?.inflow, cls: 'text-emerald-700' },
            { label: 'Money out', value: data.totals?.outflow, cls: 'text-gray-900' },
            { label: `Closing${range.end ? ` · ${dayKeyLabel(range.end)}` : ''}`, value: data.closingBalance },
          ].map(s => (
            <Card key={s.label} className="px-4 py-3">
              <p className="truncate text-[13px] text-muted-foreground">{s.label}</p>
              <p className={cn('mt-0.5 text-lg font-semibold tracking-tight tabular-nums', s.value < -0.004 ? 'text-red-600' : (s.cls ?? 'text-gray-900'))}>
                {formatAmount(s.value ?? 0, currency)}
              </p>
            </Card>
          ))}
        </div>
      )}

      {data?.preOpeningCount > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <Info className="mt-0.5 size-4 shrink-0" />
          {data.preOpeningCount} transaction{data.preOpeningCount === 1 ? ' is' : 's are'} dated before the opening date ({dayKeyLabel(data.openingDate)}) — greyed out and already in the opening balance.
        </p>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        {error ? (
          <div className="px-4 py-10 text-center text-sm text-red-600">
            {error} <button type="button" onClick={load} className="ml-2 font-medium underline underline-offset-4">Retry</button>
          </div>
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="w-32">Channel</TableHead>
                <TableHead className="w-32 text-right">In</TableHead>
                <TableHead className="w-32 text-right">Out</TableHead>
                <TableHead className="w-36 text-right">Balance</TableHead>
                <TableHead className="w-12 px-3 text-center"><span className="sr-only">Status</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && isFirstPage && (
                <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                  <TableCell className="whitespace-nowrap text-muted-foreground">{openingLabelDate ? dayKeyLabel(openingLabelDate) : '—'}</TableCell>
                  <TableCell className="font-medium text-gray-900" colSpan={4}>Opening balance</TableCell>
                  <TableCell className={cn('whitespace-nowrap text-right font-semibold tabular-nums', data.openingBalance < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(data.openingBalance, currency)}</TableCell>
                  <TableCell />
                </TableRow>
              )}
              {loading && !data && [0, 1, 2, 3, 4].map(i => (
                <TableRow key={i}><TableCell colSpan={7}><div className="h-4 animate-pulse rounded-md bg-gray-100" /></TableCell></TableRow>
              ))}
              {data && shown.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    {rows.length === 0 ? 'No transactions in this period' : 'No results'}
                  </TableCell>
                </TableRow>
              )}
              {shown.map(r => {
                const st = STATUS_ICON[r.clearStatus] ?? STATUS_ICON.UNCLEARED
                return (
                  <TableRow key={r.id} className={cn('align-top', r.excluded && 'opacity-50')}>
                    <TableCell className="whitespace-nowrap text-gray-600">{dayKeyLabel(r.date)}</TableCell>
                    <TableCell>
                      <p className="text-gray-900">{r.description}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{describe(r)}</span>
                        {r.txnId && <span className="font-mono text-gray-400">{r.txnId}</span>}
                        {r.counterAccount && (
                          <span className="inline-flex items-center gap-1 text-gray-600">
                            {r.type === 'EXPENSE' ? <>to <ArrowRight className="size-3" /></> : <>from</>} {r.counterAccount.name}
                          </span>
                        )}
                        {!r.counterAccount && (r.paidToName || r.vendor) && <span>{r.type === 'EXPENSE' ? 'Paid to' : 'From'} {r.paidToName || r.vendor}</span>}
                        {r.cheque?.no && <span>Chq {r.cheque.no}</span>}
                        {r.reference && <span className="max-w-[220px] truncate" title={r.reference}>Ref {r.reference}</span>}
                        {r.tax && (r.tax.vdsBDT > 0 || r.tax.tdsBDT > 0) && (
                          <Badge variant="purple">
                            <Receipt className="size-3" />
                            {[r.tax.vdsBDT > 0 && `VDS ${formatAmount(r.tax.vdsBDT, 'BDT')}`, r.tax.tdsBDT > 0 && `TDS/AIT ${formatAmount(r.tax.tdsBDT, 'BDT')}`].filter(Boolean).join(' · ')}
                          </Badge>
                        )}
                        {r.reversalOf && <Badge variant="warning">Reversal</Badge>}
                        {r.excluded && <Badge variant="warning">Before opening date</Badge>}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.channel ? (PAYMENT_CHANNEL_LABELS[r.channel] ?? r.channel) : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{r.inAmount > 0 ? formatAmount(r.inAmount, currency) : ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-900">{r.outAmount > 0 ? formatAmount(r.outAmount, currency) : ''}</TableCell>
                    <TableCell className={cn('whitespace-nowrap text-right font-medium tabular-nums', r.running < -0.004 ? 'text-red-600' : 'text-gray-900')}>
                      {r.excluded ? '—' : formatAmount(r.running, currency)}
                    </TableCell>
                    <TableCell className="px-3 text-center">
                      <span title={`${st.label}${r.clearedDate ? ` · ${dayKeyLabel(r.clearedDate)}` : ''}`}><st.Icon className={cn('inline size-4', st.cls)} /></span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            {data && (filtersOn || isLastPage) && (
              <TableFooter>
                {filtersOn && (
                  <TableRow className="text-xs text-muted-foreground hover:bg-transparent">
                    <TableCell className="py-2 text-muted-foreground" colSpan={3}>Shown rows on this page</TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-muted-foreground">{formatAmount(pageIn, currency)}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-muted-foreground">{formatAmount(pageOut, currency)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                )}
                {isLastPage && (
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableCell className="whitespace-nowrap text-muted-foreground">{range.end ? dayKeyLabel(range.end) : 'Today'}</TableCell>
                    <TableCell className="font-semibold text-gray-900" colSpan={2}>Closing balance</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-emerald-700">{formatAmount(data.totals?.inflow ?? 0, currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">{formatAmount(data.totals?.outflow ?? 0, currency)}</TableCell>
                    <TableCell className={cn('whitespace-nowrap text-right font-semibold tabular-nums', data.closingBalance < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(data.closingBalance, currency)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableFooter>
            )}
          </Table>
        )}
        {meta && meta.pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3"><Pagination meta={meta} onPageChange={setPage} /></div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {Object.entries(STATUS_ICON).map(([k, s]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><s.Icon className={cn('size-3.5', s.cls)} /> {s.label}</span>
        ))}
      </div>
    </div>
  )
}
