'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Upload, Download, Loader2, CheckCircle2, AlertTriangle, Lock, FileSpreadsheet, Info, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { fetchJson, errorText, fmtDay, fmtMoney, fmtTk, fmtNumber } from '../../reports/_components/format'
import { parseDelimited, mapRecords, ASSET_FIELDS, STOCK_FIELDS, assetTemplate, stockTemplate, downloadText } from './csv'

const btnPrimary = 'inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50'
const MAX_FILE_BYTES = 2 * 1024 * 1024

const SECTIONS = {
  assets: {
    label: 'Fixed assets',
    fields: ASSET_FIELDS,
    bodyKey: 'rows',
    noun: 'asset',
    help: [
      'One row per physical item. categoryCode is the category code (e.g. LAP) — names work too.',
      'cost = original cost including non-creditable VAT; accumulatedDepreciation = book depreciation up to the opening date.',
      'taxWdv = the tax written-down value brought forward at the start of the income year (from last year\'s return schedule). Leave blank to rebuild it from cost.',
      'Dates as YYYY-MM-DD or DD/MM/YYYY. employeeEmployeeId = the staff ID (assigns the asset, no acknowledgement needed). capitalized = yes/no to override the threshold.',
    ],
  },
  stock: {
    label: 'Consumable stock',
    fields: STOCK_FIELDS,
    bodyKey: 'stockRows',
    noun: 'stock item',
    help: [
      'One row per item. Leave sku blank to have one generated; an existing SKU with no movements gets its opening quantity.',
      'categoryCode must be a consumable category (e.g. STA, PAN, TON). qty and unitCost (excluding creditable VAT) are required.',
    ],
  },
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-semibold text-gray-900 mt-0.5">{value}</dd>
    </div>
  )
}

function IssueList({ title, items, tone }) {
  const [open, setOpen] = useState(tone === 'error')
  if (!items.length) return null
  const shown = open ? items.slice(0, 300) : []
  return (
    <div className={cn('rounded-xl border', tone === 'error' ? 'border-red-100 bg-red-50/60' : 'border-amber-100 bg-amber-50/60')}>
      <button onClick={() => setOpen(o => !o)} className={cn('w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium', tone === 'error' ? 'text-red-800' : 'text-amber-800')}>
        <span className="flex items-center gap-2">
          {tone === 'error' ? <XCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {items.length} {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-white/60">
          <table className="w-full text-xs">
            <tbody>
              {shown.map((it, i) => (
                <tr key={i} className="border-b border-white/70 last:border-0">
                  <td className="px-4 py-1.5 whitespace-nowrap font-medium text-gray-700 align-top">Row {it.row}</td>
                  {it.field !== undefined && <td className="px-2 py-1.5 font-mono text-gray-500 align-top">{it.field}</td>}
                  <td className="px-2 py-1.5 text-gray-700">{it.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > shown.length && <p className="px-4 py-2 text-xs text-gray-500">…and {items.length - shown.length} more</p>}
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
    if (file.size > MAX_FILE_BYTES) { toast.error('File is larger than 2 MB — split it into smaller files'); return }
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''), file.name)
    reader.onerror = () => toast.error('Could not read the file')
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
        if (json.data.valid) toast.success('No problems found — ready to import')
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

  if (loading && !info) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (loadError && !info) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState title="Couldn't load the opening register" description={loadError} action={<button className={btnPrimary} onClick={load}>Try again</button>} />
      </div>
    )
  }

  const locked = info.openingLocked
  const needsDate = !info.goLiveDate

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bg-white border border-gray-100 rounded-xl p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Opening register</h3>
              <p className="text-xs text-gray-500 mt-0.5">Equipment and stock you already owned on go-live. Imported assets are not purchases — no money moves; their cost and depreciation become opening balances.</p>
            </div>
            {locked && <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-md px-2 py-1 shrink-0"><Lock className="w-3.5 h-3.5" /> Locked</span>}
          </div>
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Go-live" value={info.goLiveDate ? fmtDay(info.goLiveDate) : 'Not set'} />
            <Stat label="Balances as at" value={effectiveAsOf ? fmtDay(effectiveAsOf) : '—'} />
            <Stat label="Tax WDV income year" value={info.taxWdvFiscalYear ? `FY ${info.taxWdvFiscalYear}` : '—'} />
            <Stat label="Capitalise from" value={fmtTk(info.capitalizationThreshold)} />
          </dl>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900">Already imported</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="Assets" value={info.assets.count} />
            <Stat label="Net book value" value={fmtTk(info.assets.bookValue)} />
            <Stat label="Cost" value={fmtTk(info.assets.cost)} />
            <Stat label="Stock value" value={`${fmtTk(info.stock.value)} · ${info.stock.items} items`} />
          </dl>
          {info.assets.count > 0 && info.assets.withTaxWdv < info.assets.count && (
            <p className="mt-3 text-xs text-amber-700">{info.assets.count - info.assets.withTaxWdv} imported asset(s) have no opening tax WDV.</p>
          )}
        </div>
      </div>

      {locked ? (
        <div className="flex items-start gap-3 bg-gray-50 border border-gray-100 rounded-xl p-4 text-sm text-gray-700">
          <Lock className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" />
          <span>Opening balances are locked, so nothing more can be imported. Add assets found later with <Link href="/admin/inventory/assets" className="underline">Add existing asset</Link>, or unlock in <Link href="/admin/finance/opening-balances" className="underline">Opening balances</Link>.</span>
        </div>
      ) : (
        <>
          {needsDate && (
            <div className="flex flex-col sm:flex-row sm:items-end gap-3 bg-amber-50 border border-amber-100 rounded-xl p-4">
              <div className="flex-1 text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>No go-live date is set. Set it in <Link href="/admin/finance/opening-balances" className="underline">Opening balances</Link> (recommended), or give the date the balances are &quot;as at&quot; here.</span>
              </div>
              <div className="w-48">
                <label className="block text-xs font-medium text-gray-600 mb-1">Balances as at</label>
                <DatePicker value={asOf} onChange={v => { setAsOf(v); setResults({ assets: null, stock: null }) }} placeholder="Choose date" />
              </div>
            </div>
          )}

          {done && (
            <div className="bg-green-50 border border-green-100 rounded-xl p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-green-800">
                <CheckCircle2 className="w-4 h-4" />
                {done.section === 'assets' ? `${done.assets.length} asset${done.assets.length === 1 ? '' : 's'} added to the register` : `${done.stockItems.length} stock item${done.stockItems.length === 1 ? '' : 's'} received as opening stock`}
              </p>
              {done.assets?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {done.assets.slice(0, 40).map(a => (
                    <Link key={a.id} href={`/admin/inventory/assets/${a.id}`} className="font-mono text-xs bg-white border border-green-100 rounded px-1.5 py-0.5 text-green-800 hover:underline">{a.assetTag}</Link>
                  ))}
                  {done.assets.length > 40 && <span className="text-xs text-green-700">+{done.assets.length - 40} more</span>}
                </div>
              )}
              {done.section === 'assets' && done.assets?.length > 0 && (
                <Link href="/admin/inventory/assets" className="mt-3 inline-block text-xs font-medium text-green-800 underline">Print labels from the asset list</Link>
              )}
            </div>
          )}

          {/* Section switch */}
          <div className="flex gap-2">
            {Object.entries(SECTIONS).map(([k, s]) => (
              <button key={k} onClick={() => setSection(k)}
                className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border', section === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                {s.label}
              </button>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{cfg.label} — paste or upload CSV</h3>
                <div className="flex flex-wrap gap-2">
                  <button className={btnGhost} onClick={() => downloadText(
                    section === 'assets' ? 'opening-assets-template.csv' : 'opening-stock-template.csv',
                    section === 'assets' ? assetTemplate({ taxFy: info.taxWdvFiscalYear || undefined }) : stockTemplate(),
                  )}>
                    <Download className="w-4 h-4" /> Template
                  </button>
                  <button className={btnGhost} onClick={() => fileRef.current?.click()}>
                    <Upload className="w-4 h-4" /> Upload CSV
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={onFile} />
                </div>
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={`Paste rows here (first row = column headers). Copying straight from Excel or Google Sheets works.\n\n${cfg.fields.map(f => f.label).join(',')}`}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              {text.trim() && (
                <div className="text-xs text-gray-600 space-y-1">
                  <p className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400" />
                    {fileNames[section] ? `${fileNames[section]} · ` : ''}{parsed.records.length} row{parsed.records.length === 1 ? '' : 's'} · {parsed.mapped.length} column{parsed.mapped.length === 1 ? '' : 's'} recognised
                  </p>
                  {parsed.missing.length > 0 && <p className="text-red-600">Missing required column{parsed.missing.length > 1 ? 's' : ''}: {parsed.missing.join(', ')}</p>}
                  {parsed.ignored.length > 0 && <p className="text-gray-400">Ignored columns: {parsed.ignored.join(', ')}</p>}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                <button className={btnGhost} onClick={() => submit(true)} disabled={checking || importing || !parsed.records.length || (needsDate && !asOf)}>
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Check rows
                </button>
                <button className={btnPrimary} onClick={() => submit(false)}
                  disabled={importing || checking || !result?.valid || (section === 'assets' ? !result?.assets?.count : !result?.stock?.count)}>
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Import {result?.valid ? (section === 'assets' ? result.assets.count : result.stock.count) : ''} {cfg.noun}s
                </button>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-100 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Info className="w-4 h-4 text-gray-400" /> How to fill it in</h3>
              <ul className="space-y-2 text-xs text-gray-600 list-disc pl-4">
                {cfg.help.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-700">Category codes</summary>
                <div className="mt-2 flex flex-wrap gap-1">
                  {info.categories.filter(c => (section === 'assets' ? c.type === 'ASSET' : c.type === 'CONSUMABLE')).map(c => (
                    <span key={c.code} className="bg-white border border-gray-200 rounded px-1.5 py-0.5" title={c.name}><span className="font-mono">{c.code}</span> {c.name}</span>
                  ))}
                </div>
              </details>
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-700">Location codes</summary>
                {info.locations.length === 0 ? (
                  <p className="mt-2">No locations yet — add them in the Locations tab.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {info.locations.map((l, i) => (
                      <span key={`${l.code}-${i}`} className="bg-white border border-gray-200 rounded px-1.5 py-0.5">{l.code ? <span className="font-mono">{l.code}</span> : <em>no code</em>} {l.name}</span>
                    ))}
                  </div>
                )}
              </details>
            </div>
          </div>

          {result && (
            <div className="space-y-4">
              <IssueList title={`problem${result.errors.length === 1 ? '' : 's'} — fix these and check again`} items={result.errors.filter(e => e.section === section)} tone="error" />
              <IssueList title={`warning${result.warnings.length === 1 ? '' : 's'}`} items={result.warnings.filter(w => w.section === section)} tone="warn" />
              {section === 'assets' ? <AssetPreview data={result.assets} /> : <StockPreview data={result.stock} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AssetPreview({ data }) {
  if (!data?.rows?.length) return null
  const rows = data.rows.slice(0, 200)
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span><span className="text-gray-500">Valid rows</span> <strong>{data.count}</strong></span>
        <span><span className="text-gray-500">Cost (capitalised)</span> <strong>{fmtTk(data.cost)}</strong></span>
        <span><span className="text-gray-500">Accumulated depreciation</span> <strong>{fmtTk(data.accumulated)}</strong></span>
        <span><span className="text-gray-500">Net book value</span> <strong>{fmtTk(data.bookValue)}</strong></span>
        {data.expensedCount > 0 && <span><span className="text-gray-500">Expensed items</span> <strong>{data.expensedCount}</strong> ({fmtTk(data.expensedCost)})</span>}
      </div>
      <div className="overflow-x-auto max-h-[420px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-3 py-2">Row</th><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Purchased</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Accum. dep.</th>
              <th className="px-3 py-2 text-right">NBV</th><th className="px-3 py-2 text-right">Tax WDV</th><th className="px-3 py-2">Capitalised</th>
              <th className="px-3 py-2">Location</th><th className="px-3 py-2">Assigned to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(r => (
              <tr key={r.row}>
                <td className="px-3 py-1.5 text-gray-400">{r.row}</td>
                <td className="px-3 py-1.5 text-gray-900">{r.name}{r.serialNumber && <span className="block text-gray-400 font-mono">{r.serialNumber}</span>}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.category}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.purchaseDate ? fmtDay(r.purchaseDate) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.cost)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.accumulated)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.bookValue)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{r.taxWdv == null ? <span className="text-gray-300">—</span> : `${fmtMoney(r.taxWdv)} (${r.taxWdvFiscalYear})`}</td>
                <td className="px-3 py-1.5">{r.isCapitalized ? 'Yes' : <span className="text-gray-400">Expensed</span>}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.location ?? ''}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.employee ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length > rows.length && <p className="px-4 py-2 text-xs text-gray-400">Showing the first {rows.length} of {data.rows.length} rows.</p>}
    </div>
  )
}

function StockPreview({ data }) {
  if (!data?.rows?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span><span className="text-gray-500">Valid rows</span> <strong>{data.count}</strong></span>
        <span><span className="text-gray-500">Stock value</span> <strong>{fmtTk(data.value, 2)}</strong></span>
      </div>
      <div className="overflow-x-auto max-h-[420px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-3 py-2">Row</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.rows.slice(0, 200).map(r => (
              <tr key={r.row}>
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
    </div>
  )
}
