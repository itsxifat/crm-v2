'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Printer, RefreshCw, AlertTriangle } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import {
  taxPeriodOf, periodFirstDay, periodLastDay, addPeriods, fiscalYearOf, fiscalYearRange, addFiscalYears, isDayKey,
} from '@/lib/finance/fiscal'
import { readJson, btnGhost, labelCls } from '../vat-return/_lib/format'
import RegisterView from './_components/RegisterView'

const TABS = [
  { type: 'sales',      label: 'Sales',       form: '6.2' },
  { type: 'purchases',  label: 'Purchases',   form: '6.1' },
  { type: 'disclosure', label: 'Disclosure',  form: '6.10' },
  { type: 'vds',        label: 'VDS',         form: null },
  { type: 'tds',        label: 'TDS / AIT',   form: null },
]
const TYPES = TABS.map(t => t.type)

function presets() {
  const now = new Date()
  const month = taxPeriodOf(now)
  const prev = addPeriods(month, -1)
  const fy = fiscalYearOf(now)
  const fyR = fiscalYearRange(fy)
  const lastFyR = fiscalYearRange(addFiscalYears(fy, -1))
  return [
    { key: 'this-month', label: 'This month', start: periodFirstDay(month), end: periodLastDay(month) },
    { key: 'last-month', label: 'Last month', start: periodFirstDay(prev), end: periodLastDay(prev) },
    { key: 'fy',         label: `FY ${fy}`,   start: fyR.startDay, end: fyR.endDay },
    { key: 'last-fy',    label: `FY ${lastFyR.fy}`, start: lastFyR.startDay, end: lastFyR.endDay },
  ]
}

export default function TaxRegistersPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <RegistersContent />
    </Suspense>
  )
}

function RegistersContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const presetList = useMemo(() => presets(), [])
  const type = TYPES.includes(searchParams.get('type')) ? searchParams.get('type') : 'sales'
  const start = isDayKey(searchParams.get('start')) ? searchParams.get('start') : presetList[1].start
  const end = isDayKey(searchParams.get('end')) ? searchParams.get('end') : presetList[1].end

  const [reg, setReg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showStock, setShowStock] = useState(false)
  const seq = useRef(0)

  const setQuery = useCallback((patch) => {
    const qs = new URLSearchParams({ type, start, end, ...patch })
    router.replace(`/admin/tax/registers?${qs}`, { scroll: false })
  }, [router, type, start, end])

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ type, start, end })
      const res = await fetch(`/api/tax/registers?${qs}`)
      const json = await readJson(res)
      if (my === seq.current) setReg(json.data)
    } catch (err) {
      if (my === seq.current) { setError(err.message); setReg(null) }
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [type, start, end])

  useEffect(() => { load() }, [load])

  const qs = new URLSearchParams({ type, start, end }).toString()
  const rangeInvalid = start > end
  const activePreset = presetList.find(p => p.start === start && p.end === end)?.key

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tax registers</h1>
          <p className="text-sm text-gray-500">Mushak-6.2 sales, 6.1 purchases, 6.10 disclosure, VDS and TDS — built from the tax ledger.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/tax/registers?${qs}&format=csv`}
            className={cn(btnGhost, (rangeInvalid || !reg?.rows?.length) && 'pointer-events-none opacity-50')}
            aria-disabled={rangeInvalid || !reg?.rows?.length}
          >
            <Download className="w-4 h-4" /> CSV
          </a>
          <button
            type="button"
            disabled={rangeInvalid}
            onClick={() => window.open(`/api/tax/registers/print?${qs}${showStock ? '&stock=1' : ''}`, '_blank', 'noopener')}
            className={btnGhost}
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-1 min-w-max" aria-label="Registers">
          {TABS.map(t => (
            <button
              key={t.type}
              type="button"
              onClick={() => setQuery({ type: t.type })}
              className={cn(
                'px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
                type === t.type ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              {t.label}{t.form && <span className="ml-1 text-xs text-gray-400">{t.form}</span>}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[200px_200px_1fr] gap-3 items-end">
          <div>
            <label className={labelCls}>From</label>
            <DatePicker value={start} onChange={v => v && setQuery({ start: v })} clearable={false} />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <DatePicker value={end} onChange={v => v && setQuery({ end: v })} clearable={false} />
          </div>
          <div className="flex flex-wrap gap-2">
            {presetList.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setQuery({ start: p.start, end: p.end })}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border',
                  activePreset === p.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                )}
              >
                {p.label}
              </button>
            ))}
            <button type="button" onClick={load} className="px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-700" aria-label="Refresh">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
        {rangeInvalid && <p className="text-sm text-red-600">The start date must not be after the end date.</p>}
        {(type === 'sales' || type === 'purchases') && (
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" className="rounded border-gray-300" checked={showStock} onChange={e => setShowStock(e.target.checked)} />
            Show stock columns (blank for services)
          </label>
        )}
      </div>

      {loading && !reg ? (
        <div className="bg-white border border-gray-100 rounded-xl"><LoadingSpinner className="py-16" /></div>
      ) : error ? (
        <div className="bg-white border border-gray-100 rounded-xl">
          <EmptyState icon={AlertTriangle} title="Could not load the register" description={error}
            action={<button type="button" onClick={load} className={btnGhost}>Try again</button>} />
        </div>
      ) : reg ? (
        <RegisterView reg={reg} showStock={showStock} loading={loading} />
      ) : null}
    </div>
  )
}
