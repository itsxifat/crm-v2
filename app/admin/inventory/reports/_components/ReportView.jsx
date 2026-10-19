'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Download, Printer, RefreshCw, Loader2, AlertTriangle, Info, X } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import PeoplePicker from '@/components/ui/PeoplePicker'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Card, CardTitle, CardDescription } from '@/components/ui/Card'
import { NativeSelect, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import { Table, TableHeader, TableBody, TableRow, TableHead } from '@/components/ui/Table'
import AssetStatusBadge from '@/components/inventory/AssetStatusBadge'
import { STATUS_OPTIONS } from '@/lib/inventory/constants'
import { fiscalYearOf, addFiscalYears } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { REPORTS, FILTER_KEYS } from './catalog'
import { fmtMoney, fmtNumber, fmtDay, fmtTk, fetchJson } from './format'
import { reportPrintHtml } from './print'

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
        ? <Link href={row._href} className="whitespace-nowrap font-mono text-xs font-medium text-gray-900 underline-offset-4 hover:underline">{v}</Link>
        : <span className="whitespace-nowrap font-mono text-xs">{v}</span>
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
          <td key={c.key} className={cn('px-4 py-2.5', isNumCol(c) && 'whitespace-nowrap text-right tabular-nums')}>
            {has ? <Cell col={c} row={totals} total /> : i === 0 ? label : ''}
          </td>
        )
      })}
    </tr>
  )
}

const cellCls = (c) => cn('px-4 py-2.5 align-top text-gray-700', isNumCol(c) && 'whitespace-nowrap text-right tabular-nums', c.type === 'text' && 'max-w-[280px]')

function SectionTable({ section }) {
  const cols = section.columns
  const grouped = Array.isArray(section.groups)
  const empty = grouped ? section.groups.length === 0 : (section.rows || []).length === 0
  return (
    <Card className="overflow-hidden">
      {(section.title || section.description) && (
        <div className="px-5 pb-3 pt-5">
          {section.title && <CardTitle>{section.title}</CardTitle>}
          {section.description && <CardDescription>{section.description}</CardDescription>}
        </div>
      )}
      {empty ? (
        <EmptyState title="No results" className="py-10" />
      ) : (
        <Table>
          <TableHeader className={cn((section.title || section.description) && '[&_tr]:border-t')}>
            <TableRow>
              {cols.map(c => (
                <TableHead key={c.key} className={cn(isNumCol(c) && 'text-right')}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grouped ? section.groups.map(g => (
              <GroupRows key={g.key} group={g} cols={cols} />
            )) : section.rows.map((r, i) => (
              <TableRow key={r._id ?? i}>
                {cols.map(c => (
                  <td key={c.key} className={cellCls(c)}>
                    <Cell col={c} row={r} />
                  </td>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <tfoot>
            <TotalsRow columns={cols} totals={section.totals} label="Total" className="border-t border-gray-200 bg-gray-50/60 font-semibold text-gray-900" />
          </tfoot>
        </Table>
      )}
    </Card>
  )
}

function GroupRows({ group, cols }) {
  return (
    <>
      <tr className="border-b border-gray-100 bg-gray-50/60">
        <td colSpan={cols.length} className="px-4 py-2 text-sm font-semibold text-gray-900">
          {group.label}
          {group.sublabel && <span className="ml-2 text-xs font-normal text-muted-foreground">{group.sublabel}</span>}
        </td>
      </tr>
      {group.rows.map((r, i) => (
        <TableRow key={r._id ?? i}>
          {cols.map(c => (
            <td key={c.key} className={cellCls(c)}>
              <Cell col={c} row={r} />
            </td>
          ))}
        </TableRow>
      ))}
      <TotalsRow columns={cols} totals={group.totals} label="Subtotal" className="border-b border-gray-100 font-medium text-gray-900" />
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
    if (!win) { toast.error('Allow pop-ups to print'); return }
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
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={report?.title ?? meta.title}
        back="/admin/inventory/reports"
        backLabel="All reports"
        description={report?.range?.label}
        actions={(
          <>
            <Button variant="ghost" size="icon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh" className="text-gray-500">
              <RefreshCw className={cn(loading && 'animate-spin')} />
            </Button>
            <Button variant="outline" onClick={downloadCsv} loading={downloading} disabled={!report}>
              {!downloading && <Download />} CSV
            </Button>
            <Button onClick={print} disabled={!report}>
              <Printer /> Print
            </Button>
          </>
        )}
      />

      {/* Filters */}
      {meta.filters.length > 0 && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          {has('range') && (
            <>
              <Field label="Period">
                <NativeSelect className="w-auto" value={rangeMode}
                  onChange={e => (e.target.value === 'fy'
                    ? set({ start: null, end: null, fy: params.fy || currentFy })
                    : set({ fy: null, start: report?.range?.startDay || null, end: report?.range?.endDay || null }))}>
                  <option value="fy">Fiscal year</option>
                  <option value="custom">Custom dates</option>
                </NativeSelect>
              </Field>
              {rangeMode === 'fy' ? (
                <Field label="Fiscal year">
                  <NativeSelect className="w-auto" value={params.fy || currentFy} onChange={e => set({ fy: e.target.value })}>
                    {fys.map(f => <option key={f} value={f}>FY {f}</option>)}
                  </NativeSelect>
                </Field>
              ) : (
                <>
                  <Field label="From" className="w-40">
                    <DatePicker value={params.start || null} onChange={v => set({ start: v })} clearable={false} />
                  </Field>
                  <Field label="To" className="w-40">
                    <DatePicker value={params.end || null} onChange={v => set({ end: v })} clearable={false} />
                  </Field>
                </>
              )}
            </>
          )}
          {has('fy') && (
            <Field label={type === 'tax-depreciation' ? 'Income year' : 'Fiscal year'}>
              <NativeSelect className="w-auto" value={params.fy || currentFy} onChange={e => set({ fy: e.target.value })}>
                {fys.map(f => <option key={f} value={f}>FY {f}</option>)}
              </NativeSelect>
            </Field>
          )}
          {has('category') && (
            <Field label="Category">
              <NativeSelect className="w-auto max-w-[220px]" value={params.categoryId || ''} onChange={e => set({ categoryId: e.target.value })}>
                <option value="">All categories</option>
                {catOptions.map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (inactive)'}</option>)}
              </NativeSelect>
            </Field>
          )}
          {has('location') && (
            <Field label="Location">
              <NativeSelect className="w-auto max-w-[240px]" value={params.locationId || ''} onChange={e => set({ locationId: e.target.value })}>
                <option value="">All locations</option>
                {(locations || []).map(l => <option key={l.id} value={l.id}>{'  '.repeat(l.depth || 0)}{l.name}{l.isActive ? '' : ' (inactive)'}</option>)}
              </NativeSelect>
            </Field>
          )}
          {has('status') && (
            <Field label="Status">
              <NativeSelect className="w-auto" value={params.status || ''} onChange={e => set({ status: e.target.value })}>
                <option value="">All held</option>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </NativeSelect>
            </Field>
          )}
          {has('employee') && (
            <Field label="Employee" className="w-64">
              {params.employeeId && !employee ? (
                <div className="flex h-9 items-center justify-between gap-2 rounded-lg border border-input bg-white px-3 text-sm shadow-xs">
                  <span className="truncate text-gray-700">Filtered by employee</span>
                  <button type="button" onClick={() => set({ employeeId: null })} className="text-gray-400 hover:text-gray-900" aria-label="Clear employee"><X className="size-4" /></button>
                </div>
              ) : (
                <PeoplePicker types={['EMPLOYEE']} typeFilter={false} value={employee} placeholder="Any employee"
                  onChange={p => { setEmployee(p); set({ employeeId: p?.id ?? null }) }} />
              )}
            </Field>
          )}
          {has('recovery') && (
            <Field label="Recovery">
              <NativeSelect className="w-auto" value={params.recoveryStatus || ''} onChange={e => set({ recoveryStatus: e.target.value })}>
                <option value="">Any status</option>
                {RECOVERY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </NativeSelect>
            </Field>
          )}
          {has('groupBy') && meta.groupBy && (
            <Field label="Group by">
              <NativeSelect className="w-auto" value={params.groupBy || meta.groupBy[0][0]} onChange={e => set({ groupBy: e.target.value })}>
                {meta.groupBy.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </NativeSelect>
            </Field>
          )}
          {has('days') && (
            <>
              <Field label="Ending within">
                <NativeSelect className="w-auto" value={params.days || '90'} onChange={e => set({ days: e.target.value })}>
                  {['30', '60', '90', '180', '365'].map(d => <option key={d} value={d}>{d} days</option>)}
                </NativeSelect>
              </Field>
              <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="rounded border-gray-300" checked={params.includeExpired === '1'}
                  onChange={e => set({ includeExpired: e.target.checked ? '1' : null })} />
                Include expired
              </label>
            </>
          )}
          {has('disposed') && (
            <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="rounded border-gray-300" checked={params.includeDisposed === '1'}
                onChange={e => set({ includeDisposed: e.target.checked ? '1' : null })} />
              Include disposed
            </label>
          )}
          {has('asOf') && (
            <Field label="As at" className="w-44">
              <DatePicker value={params.asOf || null} onChange={v => set({ asOf: v })} placeholder="Today" />
            </Field>
          )}
          {Object.keys(params).some(k => meta.filters.some(f => FILTER_KEYS[f]?.includes(k))) && (
            <Button variant="ghost" size="sm" className="mb-0.5 text-muted-foreground" onClick={() => onParamsChange({})}>Reset</Button>
          )}
        </Card>
      )}

      {error ? (
        <Card>
          <EmptyState icon={AlertTriangle} title="Couldn't build this report" description={error}
            action={<Button variant="outline" onClick={load}>Try again</Button>} />
        </Card>
      ) : !report ? (
        <Card className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-gray-400" /></Card>
      ) : (
        <div className={cn('space-y-6 transition-opacity', loading && 'opacity-60')}>
          {report.summary?.length > 0 && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
              {report.summary.map(s => (
                <Card key={s.label} className="px-4 py-3">
                  <p className="text-[13px] text-muted-foreground">{s.label}</p>
                  <p className={cn('mt-1 text-lg font-semibold tracking-tight tabular-nums', s.type === 'money' && Number(s.value) < 0 ? 'text-red-600' : 'text-gray-900')}>
                    {s.type === 'money' ? fmtTk(s.value, 0) : fmtNumber(s.value)}
                  </p>
                </Card>
              ))}
            </div>
          )}

          {report.warnings?.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              {report.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-sm text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</p>
              ))}
            </div>
          )}

          {report.sections.map(s => <SectionTable key={s.key} section={s} />)}

          {report.notes?.length > 0 && (
            <div className="space-y-1.5 rounded-lg bg-gray-50 px-4 py-3">
              {report.notes.map((n, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-gray-600"><Info className="mt-0.5 size-3.5 shrink-0 text-gray-400" />{n}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Amounts in BDT · generated {fmtDay(report.generatedAt)}
          </p>
        </div>
      )}
    </div>
  )
}
