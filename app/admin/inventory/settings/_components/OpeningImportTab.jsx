'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Upload, Download, Loader2, CheckCircle2, AlertTriangle, Lock, FileSpreadsheet, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import { Card, CardTitle, CardDescription } from '@/components/ui/Card'
import { Field, textareaClass } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { fetchJson, errorText, fmtDay, fmtMoney, fmtTk, fmtNumber } from '../../reports/_components/format'
import { parseDelimited, mapRecords, ASSET_FIELDS, STOCK_FIELDS, assetTemplate, stockTemplate, downloadText } from './csv'

const MAX_FILE_BYTES = 2 * 1024 * 1024

const SECTIONS = {
  assets: {
    label: 'Fixed assets',
    fields: ASSET_FIELDS,
    bodyKey: 'rows',
    noun: 'asset',
    help: [
      'One row per item. categoryCode = category code (e.g. LAP) or name.',
      'cost includes non-creditable VAT; accumulatedDepreciation = book depreciation to the opening date.',
      'taxWdv = tax WDV brought forward from last year\'s return schedule. Blank rebuilds it from cost.',
      'Dates: YYYY-MM-DD or DD/MM/YYYY. employeeEmployeeId = staff ID (assigns, no acknowledgement). capitalized = yes/no.',
    ],
  },
  stock: {
    label: 'Consumable stock',
    fields: STOCK_FIELDS,
    bodyKey: 'stockRows',
    noun: 'stock item',
    help: [
      'One row per item. Blank sku = auto-generated; an existing SKU with no movements gets its opening qty.',
      'categoryCode must be a consumable category (e.g. STA, PAN, TON). qty and unitCost (excl. creditable VAT) are required.',
    ],
  },
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  )
}

function IssueList({ title, items, tone }) {
  const [open, setOpen] = useState(tone === 'error')
  if (!items.length) return null
  const shown = open ? items.slice(0, 300) : []
  return (
    <div className={cn('overflow-hidden rounded-lg border', tone === 'error' ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60')}>
      <button type="button" onClick={() => setOpen(o => !o)} className={cn('flex w-full items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium', tone === 'error' ? 'text-red-800' : 'text-amber-800')}>
        <span className="flex items-center gap-2">
          {tone === 'error' ? <XCircle className="size-4" /> : <AlertTriangle className="size-4" />}
          {items.length} {title}
        </span>
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-white/60">
          <table className="w-full text-xs">
            <tbody>
              {shown.map((it, i) => (
                <tr key={i} className="border-b border-white/70 last:border-0">
                  <td className="whitespace-nowrap px-4 py-1.5 align-top font-medium text-gray-700">Row {it.row}</td>
                  {it.field !== undefined && <td className="px-2 py-1.5 align-top font-mono text-gray-500">{it.field}</td>}
                  <td className="px-2 py-1.5 text-gray-700">{it.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > shown.length && <p className="px-4 py-2 text-xs text-muted-foreground">…and {items.length - shown.length} more</p>}
        </div>
      )}
    </div>
  )
}

export default function OpeningImportTab() {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [section, setSection] = useState('assets')
  const [texts, setTexts] = useState({ assets: '', stock: '' })
  const [fileNames, setFileNames] = useState({ assets: null, stock: null })
  const [results, setResults] = useState({ assets: null, stock: null })
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(null)
  const [asOf, setAsOf] = useState(null)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const json = await fetchJson('/api/inventory/opening')
      setInfo(json.data)
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const cfg = SECTIONS[section]
  const text = texts[section]
  const parsed = useMemo(() => mapRecords(parseDelimited(text), cfg.fields), [text, cfg])
  const result = results[section]
  const effectiveAsOf = asOf || info?.asOfDate || null

  function setText(v, name = null) {
    setTexts(t => ({ ...t, [section]: v }))
    setFileNames(f => ({ ...f, [section]: name }))
    setResults(r => ({ ...r, [section]: null }))
    setDone(null)
  }

  function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { toast.error('File is over 2 MB — split it into smaller files'); return }
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''), file.name)
    reader.onerror = () => toast.error('Couldn’t read the file')
    reader.readAsText(file, 'utf-8')
  }

  async function submit(dryRun) {
    if (!parsed.records.length) { toast.error('Paste or upload rows first'); return }
    if (parsed.missing.length) { toast.error(`Missing column${parsed.missing.length > 1 ? 's' : ''}: ${parsed.missing.join(', ')}`); return }
    if (!dryRun) {
      const r = result
      const what = section === 'assets'
        ? `${r.assets.count} asset${r.assets.count === 1 ? '' : 's'} (cost ${fmtTk(r.assets.cost)}, accumulated depreciation ${fmtTk(r.assets.accumulated)})`
        : `${r.stock.count} stock item${r.stock.count === 1 ? '' : 's'} (value ${fmtTk(r.stock.value)})`
      if (!window.confirm(`Import ${what} into the opening register as at ${fmtDay(r.asOfDate)}?`)) return
    }
    if (dryRun) setChecking(true)
    else setImporting(true)
    try {
      const json = await fetchJson('/api/inventory/opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [cfg.bodyKey]: parsed.records, dryRun, ...(asOf ? { asOfDate: asOf } : {}) }),
      })
      if (dryRun) {
        setResults(r => ({ ...r, [section]: json.data }))
        if (json.data.valid) toast.success('Ready to import')
        else toast.error(`${json.data.errors.length} problem${json.data.errors.length === 1 ? '' : 's'} to fix`)
      } else {
        setDone({ section, ...json.data.created })
        setTexts(t => ({ ...t, [section]: '' }))
        setFileNames(f => ({ ...f, [section]: null }))
        setResults(r => ({ ...r, [section]: null }))
        toast.success('Opening register imported')
        load()
      }
    } catch (err) {
      if (err.data) setResults(r => ({ ...r, [section]: err.data }))
      toast.error(errorText(err))
    } finally {
      setChecking(false)
      setImporting(false)
    }
  }

  if (loading && !info) return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
  if (loadError && !info) {
    return (
      <Card>
        <EmptyState title="Couldn't load the opening register" description={loadError} action={<Button variant="outline" onClick={load}>Try again</Button>} />
      </Card>
    )
  }

  const locked = info.openingLocked
  const needsDate = !info.goLiveDate

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Opening register</CardTitle>
              <CardDescription title="Imported assets are not purchases — no money moves; their cost and depreciation become opening balances.">
                Owned at go-live; imported as opening balances.
              </CardDescription>
            </div>
            {locked && <Badge className="shrink-0"><Lock className="size-3" /> Locked</Badge>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Go-live" value={info.goLiveDate ? fmtDay(info.goLiveDate) : 'Not set'} />
            <Stat label="Balances as at" value={effectiveAsOf ? fmtDay(effectiveAsOf) : '—'} />
            <Stat label="Tax WDV income year" value={info.taxWdvFiscalYear ? `FY ${info.taxWdvFiscalYear}` : '—'} />
            <Stat label="Capitalise from" value={fmtTk(info.capitalizationThreshold)} />
          </dl>
        </Card>
        <Card className="p-5">
          <CardTitle>Already imported</CardTitle>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="Assets" value={info.assets.count} />
            <Stat label="Net book value" value={fmtTk(info.assets.bookValue)} />
            <Stat label="Cost" value={fmtTk(info.assets.cost)} />
            <Stat label="Stock value" value={`${fmtTk(info.stock.value)} · ${info.stock.items} items`} />
          </dl>
          {info.assets.count > 0 && info.assets.withTaxWdv < info.assets.count && (
            <p className="mt-3 text-xs text-amber-700">{info.assets.count - info.assets.withTaxWdv} imported asset(s) have no opening tax WDV.</p>
          )}
        </Card>
      </div>

      {locked ? (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
          <Lock className="mt-0.5 size-4 shrink-0 text-gray-500" />
          <span>Opening balances are locked. Add later finds with <Link href="/admin/inventory/assets" className="font-medium underline underline-offset-4">Add existing asset</Link>, or unlock in <Link href="/admin/finance/opening-balances" className="font-medium underline underline-offset-4">Opening balances</Link>.</span>
        </div>
      ) : (
        <>
          {needsDate && (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-end">
              <div className="flex flex-1 items-start gap-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>No go-live date. Set it in <Link href="/admin/finance/opening-balances" className="font-medium underline underline-offset-4">Opening balances</Link>, or pick an &quot;as at&quot; date here.</span>
              </div>
              <Field label="Balances as at" className="w-48">
                <DatePicker value={asOf} onChange={v => { setAsOf(v); setResults({ assets: null, stock: null }) }} placeholder="Choose date" />
              </Field>
            </div>
          )}

          {done && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                <CheckCircle2 className="size-4" />
                {done.section === 'assets' ? `${done.assets.length} asset${done.assets.length === 1 ? '' : 's'} added to the register` : `${done.stockItems.length} stock item${done.stockItems.length === 1 ? '' : 's'} received as opening stock`}
              </p>
              {done.assets?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {done.assets.slice(0, 40).map(a => (
                    <Link key={a.id} href={`/admin/inventory/assets/${a.id}`} className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:underline">{a.assetTag}</Link>
                  ))}
                  {done.assets.length > 40 && <span className="text-xs text-emerald-700">+{done.assets.length - 40} more</span>}
                </div>
              )}
              {done.section === 'assets' && done.assets?.length > 0 && (
                <Link href="/admin/inventory/assets" className="mt-3 inline-block text-xs font-medium text-emerald-800 underline underline-offset-4">Print labels from the asset list</Link>
              )}
            </div>
          )}

          {/* Section switch */}
          <Tabs
            value={section}
            onChange={setSection}
            tabs={Object.entries(SECTIONS).map(([k, s]) => ({ value: k, label: s.label }))}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="space-y-4 p-5 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{cfg.label}</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadText(
                    section === 'assets' ? 'opening-assets-template.csv' : 'opening-stock-template.csv',
                    section === 'assets' ? assetTemplate({ taxFy: info.taxWdvFiscalYear || undefined }) : stockTemplate(),
                  )}>
                    <Download /> Template
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload /> Upload CSV
                  </Button>
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={onFile} />
                </div>
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={`Paste rows, headers first (Excel and Sheets work)\n\n${cfg.fields.map(f => f.label).join(',')}`}
                className={cn(textareaClass, 'font-mono text-xs')}
              />
              {text.trim() && (
                <div className="space-y-1 text-xs text-gray-600">
                  <p className="flex items-center gap-1.5">
                    <FileSpreadsheet className="size-3.5 text-gray-400" />
                    {fileNames[section] ? `${fileNames[section]} · ` : ''}{parsed.records.length} row{parsed.records.length === 1 ? '' : 's'} · {parsed.mapped.length} column{parsed.mapped.length === 1 ? '' : 's'} recognised
                  </p>
                  {parsed.missing.length > 0 && <p className="text-red-600">Missing required column{parsed.missing.length > 1 ? 's' : ''}: {parsed.missing.join(', ')}</p>}
                  {parsed.ignored.length > 0 && <p className="text-gray-400">Ignored columns: {parsed.ignored.join(', ')}</p>}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                <Button variant="outline" onClick={() => submit(true)} loading={checking} disabled={importing || !parsed.records.length || (needsDate && !asOf)}>
                  {!checking && <CheckCircle2 />} Check rows
                </Button>
                <Button onClick={() => submit(false)} loading={importing}
                  disabled={checking || !result?.valid || (section === 'assets' ? !result?.assets?.count : !result?.stock?.count)}>
                  {!importing && <Upload />}
                  Import {result?.valid ? (section === 'assets' ? result.assets.count : result.stock.count) : ''} {cfg.noun}s
                </Button>
              </div>
            </Card>

            <Card className="h-fit space-y-3 p-5">
              <CardTitle>Column guide</CardTitle>
              <ul className="list-disc space-y-2 pl-4 text-xs text-gray-600">
                {cfg.help.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-900">Category codes</summary>
                <div className="mt-2 flex flex-wrap gap-1">
                  {info.categories.filter(c => (section === 'assets' ? c.type === 'ASSET' : c.type === 'CONSUMABLE')).map(c => (
                    <span key={c.code} className="rounded-md border border-gray-200/80 bg-white px-1.5 py-0.5" title={c.name}><span className="font-mono">{c.code}</span> {c.name}</span>
                  ))}
                </div>
              </details>
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-900">Location codes</summary>
                {info.locations.length === 0 ? (
                  <p className="mt-2">No locations yet</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {info.locations.map((l, i) => (
                      <span key={`${l.code}-${i}`} className="rounded-md border border-gray-200/80 bg-white px-1.5 py-0.5">{l.code ? <span className="font-mono">{l.code}</span> : <em>no code</em>} {l.name}</span>
                    ))}
                  </div>
                )}
              </details>
            </Card>
          </div>

          {result && (
            <div className="space-y-4">
              <IssueList title={`problem${result.errors.length === 1 ? '' : 's'} to fix before importing`} items={result.errors.filter(e => e.section === section)} tone="error" />
              <IssueList title={`warning${result.warnings.length === 1 ? '' : 's'}`} items={result.warnings.filter(w => w.section === section)} tone="warn" />
              {section === 'assets' ? <AssetPreview data={result.assets} /> : <StockPreview data={result.stock} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const thCls = 'h-9 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-muted-foreground'

function PreviewSummary({ children }) {
  return <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-gray-100 px-4 py-3 text-sm">{children}</div>
}

function SummaryItem({ label, children }) {
  return <span><span className="text-muted-foreground">{label}</span> <strong className="font-semibold tabular-nums text-gray-900">{children}</strong></span>
}

function AssetPreview({ data }) {
  if (!data?.rows?.length) return null
  const rows = data.rows.slice(0, 200)
  return (
    <Card className="overflow-hidden">
      <PreviewSummary>
        <SummaryItem label="Valid rows">{data.count}</SummaryItem>
        <SummaryItem label="Cost (capitalised)">{fmtTk(data.cost)}</SummaryItem>
        <SummaryItem label="Accumulated depreciation">{fmtTk(data.accumulated)}</SummaryItem>
        <SummaryItem label="Net book value">{fmtTk(data.bookValue)}</SummaryItem>
        {data.expensedCount > 0 && <span><span className="text-muted-foreground">Expensed items</span> <strong className="font-semibold text-gray-900">{data.expensedCount}</strong> ({fmtTk(data.expensedCost)})</span>}
      </PreviewSummary>
      <div className="max-h-[420px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-gray-100">
              <th className={thCls}>Row</th><th className={thCls}>Asset</th><th className={thCls}>Category</th>
              <th className={thCls}>Purchased</th><th className={cn(thCls, 'text-right')}>Cost</th><th className={cn(thCls, 'text-right')}>Accum. dep.</th>
              <th className={cn(thCls, 'text-right')}>NBV</th><th className={cn(thCls, 'text-right')}>Tax WDV</th><th className={thCls}>Capitalised</th>
              <th className={thCls}>Location</th><th className={thCls}>Assigned to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.row} className="hover:bg-gray-50/70">
                <td className="px-3 py-1.5 text-gray-400">{r.row}</td>
                <td className="px-3 py-1.5 text-gray-900">{r.name}{r.serialNumber && <span className="block font-mono text-gray-400">{r.serialNumber}</span>}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.category}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.purchaseDate ? fmtDay(r.purchaseDate) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.cost)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.accumulated)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.bookValue)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.taxWdv == null ? <span className="text-gray-300">—</span> : `${fmtMoney(r.taxWdv)} (${r.taxWdvFiscalYear})`}</td>
                <td className="px-3 py-1.5">{r.isCapitalized ? 'Yes' : <span className="text-gray-400">Expensed</span>}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.location ?? ''}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.employee ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length > rows.length && <p className="border-t border-gray-100 px-4 py-2 text-xs text-muted-foreground">Showing the first {rows.length} of {data.rows.length} rows.</p>}
    </Card>
  )
}

function StockPreview({ data }) {
  if (!data?.rows?.length) return null
  return (
    <Card className="overflow-hidden">
      <PreviewSummary>
        <SummaryItem label="Valid rows">{data.count}</SummaryItem>
        <SummaryItem label="Stock value">{fmtTk(data.value, 2)}</SummaryItem>
      </PreviewSummary>
      <div className="max-h-[420px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-gray-100">
              <th className={thCls}>Row</th><th className={thCls}>SKU</th><th className={thCls}>Item</th><th className={thCls}>Category</th>
              <th className={cn(thCls, 'text-right')}>Qty</th><th className={thCls}>Unit</th><th className={cn(thCls, 'text-right')}>Unit cost</th>
              <th className={cn(thCls, 'text-right')}>Value</th><th className={thCls}>Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.slice(0, 200).map(r => (
              <tr key={r.row} className="hover:bg-gray-50/70">
                <td className="px-3 py-1.5 text-gray-400">{r.row}</td>
                <td className="px-3 py-1.5 font-mono">{r.sku ?? <span className="text-gray-300">auto</span>}{r.existing && <span className="ml-1 text-gray-400">(existing)</span>}</td>
                <td className="px-3 py-1.5 text-gray-900">{r.name}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.category ?? ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtNumber(r.qty)}</td>
                <td className="px-3 py-1.5">{r.unit}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.unitCost)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.value)}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.location ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
