'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ArrowLeft, Download, Printer, RefreshCw, Loader2, AlertTriangle, Info, X, FileSpreadsheet } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import PeoplePicker from '@/components/ui/PeoplePicker'
import EmptyState from '@/components/ui/EmptyState'
import AssetStatusBadge from '@/components/inventory/AssetStatusBadge'
import { STATUS_OPTIONS } from '@/lib/inventory/constants'
import { fiscalYearOf, addFiscalYears } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { REPORTS, FILTER_KEYS } from './catalog'
import { fmtMoney, fmtNumber, fmtDay, fmtTk, fetchJson } from './format'
import { reportPrintHtml } from './print'

const selectCls = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50'

const RECOVERY_OPTIONS = [
  ['PENDING', 'Pending'], ['RECOVERED', 'Recovered'], ['WAIVED', 'Waived'], ['NOT_APPLICABLE', 'Not applicable'],
  ['AWAITING_ASSESSMENT', 'Awaiting assessment'],
]

function fyOptions(startMonth, current) {
  const cur = current || fiscalYearOf(new Date(), startMonth)
  const out = []
  for (let i = 1; i >= -8; i--) out.push(addFiscalYears(cur, i, startMonth))
  return out.filter(Boolean)
}

const isNumCol = (c) => ['money', 'number', 'percent'].includes(c.type)

function Cell({ col, row, total = false }) {
  const v = row?.[col.key]
  if (v === null || v === undefined || v === '') return <span className="text-gray-300">{total ? '' : '—'}</span>
  switch (col.type) {
    case 'money': {
      const n = Number(v)
      if (!total && Math.abs(n) < 0.005) return <span className="text-gray-300">–</span>
      return <span className={cn(n < 0 && 'text-red-600')}>{fmtMoney(n)}</span>
    }
    case 'number': return fmtNumber(v)
    case 'percent': return `${fmtNumber(v)}%`
    case 'date': return <span className="whitespace-nowrap">{fmtDay(v)}</span>
    case 'status': return <AssetStatusBadge status={v} />
    case 'tag':
      return row?._href && !total
        ? <Link href={row._href} className="font-mono text-xs text-blue-600 hover:underline whitespace-nowrap">{v}</Link>
        : <span className="font-mono text-xs whitespace-nowrap">{v}</span>
    default:
      return <span className="break-words">{String(v)}</span>
  }
}

function TotalsRow({ columns, totals, label, className }) {
  if (!totals || !Object.values(totals).some(v => v !== null && v !== undefined)) return null
  return (
    <tr className={className}>
      {columns.map((c, i) => {
        const has = Object.prototype.hasOwnProperty.call(totals, c.key) && totals[c.key] !== null
        return (
          <td key={c.key} className={cn('px-3 py-2', isNumCol(c) && 'text-right tabular-nums whitespace-nowrap')}>
            {has ? <Cell col={c} row={totals} total /> : i === 0 ? label : ''}
          </td>
        )
      })}
    </tr>
  )
}

function SectionTable({ section }) {
  const cols = section.columns
  const grouped = Array.isArray(section.groups)
  const empty = grouped ? section.groups.length === 0 : (section.rows || []).length === 0
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      {(section.title || section.description) && (
        <div className="px-4 pt-4 pb-2">
          {section.title && <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>}
          {section.description && <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>}
        </div>
      )}
      {empty ? (
        <EmptyState title="Nothing to show" description="No records match these filters." className="py-10" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50/60">
                {cols.map(c => (
                  <th key={c.key} className={cn('px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap', isNumCol(c) ? 'text-right' : 'text-left')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {grouped ? section.groups.map(g => (
                <GroupRows key={g.key} group={g} cols={cols} />
              )) : section.rows.map((r, i) => (
                <tr key={r._id ?? i} className="hover:bg-gray-50/60 align-top">
                  {cols.map(c => (
                    <td key={c.key} className={cn('px-3 py-2 text-gray-700', isNumCol(c) && 'text-right tabular-nums whitespace-nowrap', c.type === 'text' && 'max-w-[280px]')}>
                      <Cell col={c} row={r} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <TotalsRow columns={cols} totals={section.totals} label="Total" className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900" />
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function GroupRows({ group, cols }) {
  return (
    <>
      <tr className="bg-gray-50/80">
        <td colSpan={cols.length} className="px-3 py-2 text-sm font-semibold text-gray-900">
          {group.label}
          {group.sublabel && <span className="ml-2 text-xs font-normal text-gray-500">{group.sublabel}</span>}
        </td>
      </tr>
      {group.rows.map((r, i) => (
        <tr key={r._id ?? i} className="hover:bg-gray-50/60 align-top">
          {cols.map(c => (
            <td key={c.key} className={cn('px-3 py-2 text-gray-700', isNumCol(c) && 'text-right tabular-nums whitespace-nowrap', c.type === 'text' && 'max-w-[280px]')}>
              <Cell col={c} row={r} />
            </td>
          ))}
        </tr>
      ))}
      <TotalsRow columns={cols} totals={group.totals} label="Subtotal" className="font-medium text-gray-800 bg-white border-t border-gray-100" />
    </>
  )
}

/**
 * One report: filters (synced to the URL by the parent), summary, sections,
 * CSV download and print.
 */
export default function ReportView({ type, params, onParamsChange, categories, locations }) {
  const meta = REPORTS[type]
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [employee, setEmployee] = useState(null)
  const companyRef = useRef(null)
  const seq = useRef(0)

  const startMonth = report?.fiscalYearStartMonth || 7
  const currentFy = report?.currentFiscalYear || fiscalYearOf(new Date(), startMonth)
  const fys = useMemo(() => fyOptions(startMonth, currentFy), [startMonth, currentFy])

  const query = useMemo(() => {
    const q = new URLSearchParams()
    q.set('type', type)
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
    return q.toString()
  }, [type, params])

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson(`/api/inventory/reports?${query}`)
      if (id !== seq.current) return
      setReport(json.data)
    } catch (err) {
      if (id !== seq.current) return
      setError(err.message)
      setReport(null)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [query])

  useEffect(() => { load() }, [load])

  const set = (patch) => {
    const next = { ...params, ...patch }
    for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined || next[k] === '') delete next[k]
    onParamsChange(next)
  }

  const has = (f) => meta?.filters.includes(f)
  const rangeMode = params.start || params.end ? 'custom' : 'fy'
  const catOptions = (categories || []).filter(c => !meta?.categoryType || c.type === meta.categoryType)

  async function downloadCsv() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/inventory/reports?${query}&format=csv`)
      if (!res.ok) {
        let msg = 'Download failed'
        try { msg = (await res.json()).error || msg } catch { /* not JSON */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const name = /filename="([^"]+)"/.exec(cd)?.[1] || `inventory-${type}.csv`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDownloading(false)
    }
  }

  function filtersText() {
    const parts = []
    if (params.categoryId) parts.push(`Category: ${catOptions.find(c => c.id === params.categoryId)?.name ?? 'selected'}`)
    if (params.locationId) parts.push(`Location: ${locations?.find(l => l.id === params.locationId)?.path ?? 'selected'}`)
    if (params.status) parts.push(`Status: ${STATUS_OPTIONS.find(s => s.value === params.status)?.label ?? params.status}`)
    if (params.employeeId) parts.push(`Employee: ${employee?.name ?? 'selected'}`)
    if (params.recoveryStatus) parts.push(`Recovery: ${RECOVERY_OPTIONS.find(r => r[0] === params.recoveryStatus)?.[1]}`)
    if (params.groupBy) parts.push(`Grouped by ${params.groupBy}`)
    if (params.includeDisposed) parts.push('Including disposed')
    return parts.join(' · ')
  }

  async function print() {
    if (!report) return
    const win = window.open('', '_blank')
    if (!win) { toast.error('Allow pop-ups for this site to print'); return }
    if (companyRef.current === null) {
      try {
        const json = await fetchJson('/api/settings?group=company')
        companyRef.current = json.data?.company_name || ''
      } catch {
        companyRef.current = ''
      }
    }
    win.document.open()
    win.document.write(reportPrintHtml(report, { companyName: companyRef.current, filtersText: filtersText() }))
    win.document.close()
    win.focus()
    setTimeout(() => { try { win.print() } catch { /* window closed */ } }, 400)
  }

  if (!meta) return null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/inventory/reports" className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-3.5 h-3.5" /> All reports
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-gray-900">{report?.title ?? meta.title}</h1>
          <p className="text-sm text-gray-500">{report?.description ?? meta.description}</p>
          {report?.range?.label && <p className="text-xs text-gray-400 mt-0.5">{report.range.label}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
          </button>
          <button className={btnGhost} onClick={downloadCsv} disabled={!report || downloading}>
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} CSV
          </button>
          <button className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50" onClick={print} disabled={!report}>
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Filters */}
      {meta.filters.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-end gap-3">
          {has('range') && (
            <>
              <div>
                <label className={labelCls}>Period</label>
                <select className={selectCls} value={rangeMode}
                  onChange={e => (e.target.value === 'fy'
                    ? set({ start: null, end: null, fy: params.fy || currentFy })
                    : set({ fy: null, start: report?.range?.startDay || null, end: report?.range?.endDay || null }))}>
                  <option value="fy">Fiscal year</option>
                  <option value="custom">Custom dates</option>
                </select>
              </div>
              {rangeMode === 'fy' ? (
                <div>
                  <label className={labelCls}>Fiscal year</label>
                  <select className={selectCls} value={params.fy || currentFy} onChange={e => set({ fy: e.target.value })}>
                    {fys.map(f => <option key={f} value={f}>FY {f}</option>)}
                  </select>
                </div>
              ) : (
                <>
                  <div className="w-40">
                    <label className={labelCls}>From</label>
                    <DatePicker value={params.start || null} onChange={v => set({ start: v })} clearable={false} />
                  </div>
                  <div className="w-40">
                    <label className={labelCls}>To</label>
                    <DatePicker value={params.end || null} onChange={v => set({ end: v })} clearable={false} />
                  </div>
                </>
              )}
            </>
          )}
          {has('fy') && (
            <div>
              <label className={labelCls}>{type === 'tax-depreciation' ? 'Income year' : 'Fiscal year'}</label>
              <select className={selectCls} value={params.fy || currentFy} onChange={e => set({ fy: e.target.value })}>
                {fys.map(f => <option key={f} value={f}>FY {f}</option>)}
              </select>
            </div>
          )}
          {has('category') && (
            <div>
              <label className={labelCls}>Category</label>
              <select className={cn(selectCls, 'max-w-[220px]')} value={params.categoryId || ''} onChange={e => set({ categoryId: e.target.value })}>
                <option value="">All categories</option>
                {catOptions.map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (inactive)'}</option>)}
              </select>
            </div>
          )}
          {has('location') && (
            <div>
              <label className={labelCls}>Location</label>
              <select className={cn(selectCls, 'max-w-[240px]')} value={params.locationId || ''} onChange={e => set({ locationId: e.target.value })}>
                <option value="">All locations</option>
                {(locations || []).map(l => <option key={l.id} value={l.id}>{'  '.repeat(l.depth || 0)}{l.name}{l.isActive ? '' : ' (inactive)'}</option>)}
              </select>
            </div>
          )}
          {has('status') && (
            <div>
              <label className={labelCls}>Status</label>
              <select className={selectCls} value={params.status || ''} onChange={e => set({ status: e.target.value })}>
                <option value="">All held</option>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
          {has('employee') && (
            <div className="w-64">
              <label className={labelCls}>Employee</label>
              {params.employeeId && !employee ? (
                <div className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <span className="text-gray-700 truncate">Filtered by employee</span>
                  <button onClick={() => set({ employeeId: null })} className="text-gray-400 hover:text-gray-600" aria-label="Clear employee"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <PeoplePicker types={['EMPLOYEE']} typeFilter={false} value={employee} placeholder="Any employee"
                  onChange={p => { setEmployee(p); set({ employeeId: p?.id ?? null }) }} />
              )}
            </div>
          )}
          {has('recovery') && (
            <div>
              <label className={labelCls}>Recovery</label>
              <select className={selectCls} value={params.recoveryStatus || ''} onChange={e => set({ recoveryStatus: e.target.value })}>
                <option value="">Any status</option>
                {RECOVERY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
          {has('groupBy') && meta.groupBy && (
            <div>
              <label className={labelCls}>Group by</label>
              <select className={selectCls} value={params.groupBy || meta.groupBy[0][0]} onChange={e => set({ groupBy: e.target.value })}>
                {meta.groupBy.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
          {has('days') && (
            <>
              <div>
                <label className={labelCls}>Ending within</label>
                <select className={selectCls} value={params.days || '90'} onChange={e => set({ days: e.target.value })}>
                  {['30', '60', '90', '180', '365'].map(d => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                <input type="checkbox" className="rounded border-gray-300" checked={params.includeExpired === '1'}
                  onChange={e => set({ includeExpired: e.target.checked ? '1' : null })} />
                Include expired
              </label>
            </>
          )}
          {has('disposed') && (
            <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
              <input type="checkbox" className="rounded border-gray-300" checked={params.includeDisposed === '1'}
                onChange={e => set({ includeDisposed: e.target.checked ? '1' : null })} />
              Include disposed
            </label>
          )}
          {has('asOf') && (
            <div className="w-44">
              <label className={labelCls}>As at (optional)</label>
              <DatePicker value={params.asOf || null} onChange={v => set({ asOf: v })} placeholder="Today" />
            </div>
          )}
          {Object.keys(params).some(k => meta.filters.some(f => FILTER_KEYS[f]?.includes(k))) && (
            <button className="text-xs font-medium text-gray-500 hover:text-gray-900 pb-2.5" onClick={() => onParamsChange({})}>Reset</button>
          )}
        </div>
      )}

      {error ? (
        <div className="bg-white border border-gray-100 rounded-xl">
          <EmptyState icon={AlertTriangle} title="Couldn't build this report" description={error}
            action={<button onClick={load} className="bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">Try again</button>} />
        </div>
      ) : !report ? (
        <div className="bg-white border border-gray-100 rounded-xl py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', loading && 'opacity-60')}>
          {report.summary?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {report.summary.map(s => (
                <div key={s.label} className="bg-white border border-gray-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={cn('mt-1 text-lg font-semibold tabular-nums', s.type === 'money' && Number(s.value) < 0 ? 'text-red-600' : 'text-gray-900')}>
                    {s.type === 'money' ? fmtTk(s.value, 0) : fmtNumber(s.value)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {report.warnings?.length > 0 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 space-y-1.5">
              {report.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-sm text-amber-800"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w}</p>
              ))}
            </div>
          )}

          {report.sections.map(s => <SectionTable key={s.key} section={s} />)}

          {report.notes?.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-1.5">
              {report.notes.map((n, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-gray-600"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />{n}</p>
              ))}
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Amounts in BDT · generated {fmtDay(report.generatedAt)}
          </p>
        </div>
      )}
    </div>
  )
}
