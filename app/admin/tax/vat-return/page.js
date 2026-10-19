'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Printer, RefreshCw, Send, AlertTriangle, CheckCircle2, Receipt, CalendarRange, Lock, Paperclip, Landmark,
} from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, NativeSelect, Label, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import { usePermission } from '@/components/auth/Can'
import DepositModal from '@/components/tax/DepositModal'
import { cn } from '@/lib/utils'
import { periodLastDay } from '@/lib/finance/fiscal'
import ReturnView from './_components/ReturnView'
import NoteDrilldown from './_components/NoteDrilldown'
import FileReturnModal from './_components/FileReturnModal'
import DraftModal from './_components/DraftModal'
import FiledHistory, { FilingStatusBadge, FilingEditModal } from './_components/FiledHistory'
import {
  fmtAmount, fmtDay, fmtPeriod, toNum, round2, todayKey, readJson, RETURN_TYPE_LABELS,
} from './_lib/format'

const DRIFT_KEYS = [
  { key: '9c', label: 'Output VAT (9c)', get: r => toNum(r?.notes?.[9]?.c) },
  { key: '23b', label: 'Input tax credit (23b)', get: r => toNum(r?.notes?.[23]?.b) },
  { key: '28', label: 'Increasing adjustments (28)', get: r => toNum(r?.notes?.[28]) },
  { key: '33', label: 'Decreasing adjustments (33)', get: r => toNum(r?.notes?.[33]) },
  { key: '52', label: 'Balance brought forward (52)', get: r => toNum(r?.notes?.[52]) },
  { key: '53', label: 'SD balance brought forward (53)', get: r => toNum(r?.notes?.[53]) },
  { key: '50', label: 'Net payable (50)', get: r => toNum(r?.notes?.[50]) },
  { key: '51', label: 'Net payable SD (51)', get: r => toNum(r?.notes?.[51]) },
  { key: '58', label: 'Deposits (58)', get: r => toNum(r?.notes?.[58]) },
  { key: '59', label: 'SD deposits (59)', get: r => toNum(r?.notes?.[59]) },
  { key: '65', label: 'Closing balance carried forward (65)', get: r => toNum(r?.notes?.[65]) },
  { key: '66', label: 'SD closing balance carried forward (66)', get: r => toNum(r?.notes?.[66]) },
]
// Drift in these comes from an EARLIER return (amended / filed late / opening balance changed).
const CARRY_KEYS = ['52', '53']

export default function VatReturnPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <VatReturnContent />
    </Suspense>
  )
}

function VatReturnContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermission()
  const canDeposit = can('tax.deposits.manage')
  const qsStart = searchParams.get('start')
  const qsEnd = searchParams.get('end')
  const qsPeriod = searchParams.get('period')

  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('live')
  const [showAll, setShowAll] = useState(false)
  const [drillNote, setDrillNote] = useState(null)
  const [fileOpen, setFileOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [editFiling, setEditFiling] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [customOpen, setCustomOpen] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (qsStart) qs.set('start', qsStart)
      if (qsEnd) qs.set('end', qsEnd)
      if (!qsStart && !qsEnd && qsPeriod) qs.set('period', qsPeriod)
      const res = await fetch(`/api/tax/vat-return${qs.toString() ? `?${qs}` : ''}`)
      const json = await readJson(res)
      if (my !== seq.current) return
      setResp(json)
      const filed = json.filing && ['FILED', 'AMENDED'].includes(json.filing.status) && json.filing.snapshot?.notes
      setView(filed ? 'filed' : 'live')
      setCustomStart(json.period?.start ?? '')
      setCustomEnd(json.period?.end ?? '')
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [qsStart, qsEnd, qsPeriod])

  useEffect(() => { load() }, [load])

  const selectPeriod = useCallback((start, end) => {
    if (!start || !end) return
    setCustomOpen(false)
    router.replace(`/admin/tax/vat-return?start=${start}&end=${end}`, { scroll: false })
  }, [router])

  const period = resp?.period ?? null
  const data = resp?.data ?? null
  const filing = resp?.filing ?? null
  const settings = resp?.settings ?? null
  const perms = resp?.permissions ?? {}
  const filed = !!filing && ['FILED', 'AMENDED'].includes(filing.status)
  const hasSnapshot = filed && !!filing?.snapshot?.notes
  const shown = view === 'filed' && hasSnapshot ? filing.snapshot : data
  const periodEnded = period ? todayKey() > periodLastDay(period.end) : false

  const drift = useMemo(() => {
    if (!hasSnapshot || !data) return []
    return DRIFT_KEYS
      .map(k => ({ ...k, filed: round2(k.get(filing.snapshot)), live: round2(k.get(data)) }))
      .filter(k => Math.abs(k.filed - k.live) > 0.005)
  }, [hasSnapshot, filing, data])

  const carryDrift = drift.some(d => CARRY_KEYS.includes(d.key))

  const history = filing?.snapshot?.history ?? []
  // Still to pay on the live computation (note 50 − note 58).
  const balanceDue = round2(Math.max(0, toNum(data?.summary?.balanceDue)))
  // A range that splits the single Jul–Sep 2026 return or overlaps a filed return
  // cannot be saved, paid or filed (the server refuses it too).
  const unfileable = data?.fileable === false
  const rangeProblem = unfileable ? data?.rangeProblem ?? null : null

  function openPrint() {
    if (!period) return
    const qs = new URLSearchParams({ start: period.start, end: period.end, source: view === 'filed' && hasSnapshot ? 'filed' : 'live' })
    window.open(`/api/tax/vat-return/print?${qs}`, '_blank', 'noopener')
  }

  function applyCustom() {
    if (!/^\d{4}-\d{2}$/.test(customStart) || !/^\d{4}-\d{2}$/.test(customEnd)) return
    if (customStart > customEnd) return
    selectPeriod(customStart, customEnd)
  }

  if (loading && !resp) return <PageLoader />

  if (error && !resp) {
    return (
      <Card>
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the VAT return"
          description={error}
          action={<Button onClick={load}>Try again</Button>}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="VAT return"
        meta={<Badge variant="outline">Mushak-9.1</Badge>}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh">
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
            <Button variant="outline" onClick={openPrint} disabled={!period}>
              <Printer /> Working paper
            </Button>
            {/* Titles sit on a wrapper: disabled Buttons ignore the pointer, so their own tooltip would never show. */}
            {perms.canFile && !filed && (
              <span className="inline-flex" title={unfileable ? rangeProblem?.message : undefined}>
                <Button
                  variant="outline"
                  onClick={() => setDraftOpen(true)}
                  disabled={!period || unfileable}
                >
                  <Receipt /> Challans
                </Button>
              </span>
            )}
            {canDeposit && period && (!filed || balanceDue > 0.005) && (
              <span className="inline-flex" title={unfileable ? rangeProblem?.message : 'Record a treasury challan / e-payment for this return (note 58)'}>
                <Button
                  variant="outline"
                  onClick={() => setPayOpen(true)}
                  disabled={unfileable}
                >
                  <Landmark /> Pay VAT
                </Button>
              </span>
            )}
            {perms.canFile && (
              <span className="inline-flex" title={unfileable ? rangeProblem?.message : (!periodEnded ? 'A return can be filed after the tax period ends' : undefined)}>
                <Button
                  onClick={() => setFileOpen(true)}
                  disabled={!period || !periodEnded || unfileable}
                >
                  <Send /> {filed ? 'File amended return' : 'File return'}
                </Button>
              </span>
            )}
          </>
        }
      />

      {/* Period picker */}
      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="vat-return-period">
              Return period
              {settings?.returnFrequency && <span className="ml-1 font-normal text-muted-foreground">· {settings.returnFrequency === 'QUARTERLY' ? 'quarterly' : 'monthly'}</span>}
            </Label>
            <NativeSelect
              id="vat-return-period"
              value={period?.key ?? ''}
              onChange={e => {
                const p = resp?.periods?.find(x => x.key === e.target.value)
                if (p) selectPeriod(p.start, p.end)
              }}
            >
              {period && !resp?.periods?.some(p => p.key === period.key) && (
                <option value={period.key}>{period.label} (custom)</option>
              )}
              {(resp?.periods ?? []).map(p => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {p.status === 'FILED' ? ' · Filed' : p.status === 'AMENDED' ? ' · Amended' : p.status === 'DRAFT' ? ' · Draft' : ''}
                  {p.isCurrent ? ' · current' : ''}
                  {p.overdue ? ' · overdue' : (!p.status && p.ended ? ` · due ${fmtDay(p.dueDate)}` : '')}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button variant={customOpen ? 'secondary' : 'outline'} onClick={() => setCustomOpen(v => !v)}>
            <CalendarRange /> Custom range
          </Button>
        </div>
        {customOpen && (
          <div className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="From month">
              <Input type="month" value={customStart} onChange={e => setCustomStart(e.target.value)} />
            </Field>
            <Field label="To month">
              <Input type="month" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </Field>
            <Button variant="secondary" onClick={applyCustom} disabled={!customStart || !customEnd || customStart > customEnd}>
              Show
            </Button>
          </div>
        )}
        {period && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span>Tax period <span className="font-medium text-gray-900">{fmtPeriod(period.start)}{period.end !== period.start ? ` – ${fmtPeriod(period.end)}` : ''}</span></span>
            <span>Due <span className={cn('font-medium', !filed && periodEnded && todayKey() > period.dueDate ? 'text-red-600' : 'text-gray-900')}>{fmtDay(period.dueDate)}</span></span>
            {settings?.taxLockedUntil && (
              <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> VAT entries locked to {fmtDay(settings.taxLockedUntil)}</span>
            )}
            {loading && <span className="inline-flex items-center gap-1"><RefreshCw className="size-3.5 animate-spin" /> Updating…</span>}
          </div>
        )}
      </Card>

      {error && resp && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {rangeProblem && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 sm:flex-row sm:items-center">
          <AlertTriangle className="hidden size-4 shrink-0 text-amber-600 sm:block" />
          <p className="flex-1">
            {rangeProblem.message}. Reference only — this range can&apos;t be saved, paid or filed.
          </p>
          {rangeProblem.suggest && (
            <Button variant="outline" size="sm" onClick={() => selectPeriod(rangeProblem.suggest.start, rangeProblem.suggest.end)}>
              Open {rangeProblem.suggest.label ?? `${rangeProblem.suggest.start} – ${rangeProblem.suggest.end}`}
            </Button>
          )}
        </div>
      )}

      {/* Filing status */}
      {filed ? (
        <Card className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                  {filing.status === 'AMENDED' ? 'Amended return recorded' : 'Return filed'}
                  <FilingStatusBadge status={filing.status} />
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {RETURN_TYPE_LABELS[filing.returnType] ?? filing.returnType} · submitted {fmtDay(filing.filedAt)}
                  {filing.filedBy?.name ? ` · by ${filing.filedBy.name}` : ''}
                  {filing.acknowledgementNo ? ` · ack ${filing.acknowledgementNo}` : ' · no acknowledgement no. yet'}
                </p>
                {filing.attachmentUrl && (
                  <a href={filing.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-gray-900 underline-offset-4 hover:underline">
                    <Paperclip className="size-3.5 text-gray-500" /> Return copy
                  </a>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasSnapshot && (
                <Tabs
                  size="sm"
                  value={view}
                  onChange={setView}
                  tabs={[{ value: 'filed', label: 'As filed' }, { value: 'live', label: 'Live ledger' }]}
                />
              )}
              {perms.canFile && (
                <Button variant="outline" size="sm" onClick={() => setEditFiling(filing)}>Acknowledgement</Button>
              )}
            </div>
          </div>
          {drift.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-medium">
                  {carryDrift
                    ? 'The balance brought forward from the earlier return changed after this return was filed.'
                    : 'The tax ledger changed after this return was filed.'}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs tabular-nums">
                  {drift.map(d => (
                    <li key={d.key}>{d.label}: filed Tk {fmtAmount(d.filed)} → now Tk {fmtAmount(d.live)}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs">
                  {carryDrift
                    ? 'File an amended return (s.66) for this period, then amend each later filed return in turn.'
                    : 'If the change belongs to this period, file an amended return (s.66).'}
                </p>
              </div>
            </div>
          )}
        </Card>
      ) : filing?.status === 'DRAFT' ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <Receipt className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>Draft — {filing.challans?.length || 0} challan(s) saved{filing.notes ? ` · ${filing.notes}` : ''}. Not filed yet.</span>
        </div>
      ) : null}

      <ReturnView
        shown={shown}
        period={period}
        settings={settings}
        canFile={!!perms.canFile}
        filed={filed}
        showingFiled={view === 'filed' && hasSnapshot}
        showAll={showAll}
        onShowAll={setShowAll}
        onDrill={setDrillNote}
        onEditChallans={() => setDraftOpen(true)}
        history={history}
      />

      <FiledHistory
        refreshKey={historyKey}
        currentKey={period?.key}
        canFile={!!perms.canFile}
        onSelect={selectPeriod}
        onChanged={load}
      />

      <NoteDrilldown note={drillNote} result={shown} onClose={() => setDrillNote(null)} />

      <FileReturnModal
        open={fileOpen}
        onClose={() => setFileOpen(false)}
        period={period}
        result={data}
        filing={filing}
        settings={settings}
        onFiled={() => { setFileOpen(false); setHistoryKey(k => k + 1); load() }}
      />

      <DraftModal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        period={period}
        filing={filing}
        settings={settings}
        onSaved={() => { setDraftOpen(false); setHistoryKey(k => k + 1); load() }}
      />

      <DepositModal
        open={payOpen}
        onOpenChange={setPayOpen}
        kind="VAT"
        returnPeriod={period ? { start: period.start, end: period.end, label: period.label } : null}
        defaultAmount={balanceDue > 0 ? balanceDue : null}
        onSaved={() => { setHistoryKey(k => k + 1); load() }}
      />

      <FilingEditModal
        filing={editFiling}
        onClose={() => setEditFiling(null)}
        onSaved={() => { setEditFiling(null); setHistoryKey(k => k + 1); load() }}
      />
    </div>
  )
}
