'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Printer, RefreshCw, AlertTriangle } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Label } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'
import {
  taxPeriodOf, periodFirstDay, periodLastDay, addPeriods, fiscalYearOf, fiscalYearRange, addFiscalYears, isDayKey,
} from '@/lib/finance/fiscal'
import { readJson } from '../vat-return/_lib/format'
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
    <div className="space-y-6">
      <PageHeader
        title="Tax registers"
        actions={
          <>
            <a
              href={`/api/tax/registers?${qs}&format=csv`}
              className={cn(buttonVariants({ variant: 'outline' }), (rangeInvalid || !reg?.rows?.length) && 'pointer-events-none opacity-50')}
              aria-disabled={rangeInvalid || !reg?.rows?.length}
            >
              <Download /> CSV
            </a>
            <Button
              variant="outline"
              disabled={rangeInvalid}
              onClick={() => window.open(`/api/tax/registers/print?${qs}${showStock ? '&stock=1' : ''}`, '_blank', 'noopener')}
            >
              <Printer /> Print
            </Button>
          </>
        }
      />

      {/* Tabs */}
      <nav aria-label="Registers">
        <Tabs
          variant="underline"
          value={type}
          onChange={v => setQuery({ type: v })}
          tabs={TABS.map(t => ({
            value: t.type,
            label: t.form ? <>{t.label}<span className="ml-1 text-xs font-normal text-muted-foreground">{t.form}</span></> : t.label,
          }))}
        />
      </nav>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-44">
            <Label>From</Label>
            <DatePicker value={start} onChange={v => v && setQuery({ start: v })} clearable={false} />
          </div>
          <div className="w-full sm:w-44">
            <Label>To</Label>
            <DatePicker value={end} onChange={v => v && setQuery({ end: v })} clearable={false} />
          </div>
          <Tabs
            value={activePreset ?? ''}
            onChange={key => {
              const p = presetList.find(x => x.key === key)
              if (p) setQuery({ start: p.start, end: p.end })
            }}
            tabs={presetList.map(p => ({ value: p.key, label: p.label }))}
          />
          <div className="ml-auto flex items-center gap-3">
            {(type === 'sales' || type === 'purchases') && (
              <label className="inline-flex items-center gap-2 text-[13px] text-gray-700" title="Stock columns stay blank for services">
                <input type="checkbox" className="rounded border-gray-300" checked={showStock} onChange={e => setShowStock(e.target.checked)} />
                Show stock columns
              </label>
            )}
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh" title="Refresh">
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        {rangeInvalid && <p className="text-sm text-red-600">The start date must not be after the end date.</p>}
      </div>

      {loading && !reg ? (
        <Card><LoadingSpinner className="py-16" /></Card>
      ) : error ? (
        <Card>
          <EmptyState icon={AlertTriangle} title="Couldn't load the register" description={error}
            action={<Button variant="outline" onClick={load}>Try again</Button>} />
        </Card>
      ) : reg ? (
        <RegisterView reg={reg} showStock={showStock} loading={loading} />
      ) : null}
    </div>
  )
}
