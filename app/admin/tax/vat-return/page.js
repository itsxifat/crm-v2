'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Printer, RefreshCw, Send, AlertTriangle, CheckCircle2, Receipt, CalendarRange, Lock, Paperclip, Landmark,
} from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
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
  fmtAmount, fmtDay, fmtPeriod, toNum, round2, todayKey, readJson, RETURN_TYPE_LABELS, inputCls, labelCls, btnPrimary, btnGhost,
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
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load the VAT return"
          description={error}
          action={<button type="button" onClick={load} className={btnPrimary}>Try again</button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">VAT return (Mushak-9.1)</h1>
          <p className="text-sm text-gray-500">
            Computed from the tax ledger. Submit on the NBR eVAT portal, then record the filing here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className={btnGhost} aria-label="Refresh">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button type="button" onClick={openPrint} disabled={!period} className={btnGhost}>
            <Printer className="w-4 h-4" /> Working paper
          </button>
          {perms.canFile && !filed && (
            <button
              type="button"
              onClick={() => setDraftOpen(true)}
              disabled={!period || unfileable}
              title={unfileable ? rangeProblem?.message : undefined}
              className={btnGhost}
            >
              <Receipt className="w-4 h-4" /> Challans
            </button>
          )}
          {canDeposit && period && (!filed || balanceDue > 0.005) && (
            <button
              type="button"
              onClick={() => setPayOpen(true)}
              disabled={unfileable}
              className={btnGhost}
              title={unfileable ? rangeProblem?.message : 'Record a treasury challan / e-payment for this return (note 58)'}
            >
              <Landmark className="w-4 h-4" /> Pay VAT
            </button>
          )}
          {perms.canFile && (
            <button
              type="button"
              onClick={() => setFileOpen(true)}
              disabled={!period || !periodEnded || unfileable}
              title={unfileable ? rangeProblem?.message : (!periodEnded ? 'A return can be filed after the tax period ends' : undefined)}
              className={btnPrimary}
            >
              <Send className="w-4 h-4" /> {filed ? 'File amended return' : 'File return'}
            </button>
          )}
        </div>
      </div>

      {/* Period picker */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className={labelCls}>Return period {settings?.returnFrequency && <span className="text-gray-400 font-normal">· {settings.returnFrequency === 'QUARTERLY' ? 'quarterly' : 'monthly'} returns</span>}</label>
            <select
              className={inputCls}
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
            </select>
          </div>
          <button type="button" onClick={() => setCustomOpen(v => !v)} className={btnGhost}>
            <CalendarRange className="w-4 h-4" /> Custom range
          </button>
        </div>
        {customOpen && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <div>
              <label className={labelCls}>From month</label>
              <input type="month" className={inputCls} value={customStart} onChange={e => setCustomStart(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>To month</label>
              <input type="month" className={inputCls} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </div>
            <button type="button" onClick={applyCustom} disabled={!customStart || !customEnd || customStart > customEnd} className={btnPrimary}>
              Show
            </button>
          </div>
        )}
        {period && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>Tax period: <span className="font-medium text-gray-700">{fmtPeriod(period.start)}{period.end !== period.start ? ` – ${fmtPeriod(period.end)}` : ''}</span></span>
            <span>Due: <span className={cn('font-medium', !filed && periodEnded && todayKey() > period.dueDate ? 'text-red-600' : 'text-gray-700')}>{fmtDay(period.dueDate)}</span></span>
            {settings?.taxLockedUntil && (
              <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> VAT entries locked to {fmtDay(settings.taxLockedUntil)}</span>
            )}
            {loading && <span className="inline-flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Updating…</span>}
          </div>
        )}
      </div>

      {error && resp && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {rangeProblem && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 hidden sm:block" />
          <p className="flex-1">
            {rangeProblem.message}. These figures are for reference only — challans cannot be saved, VAT cannot be paid and the return cannot be filed for this range.
          </p>
          {rangeProblem.suggest && (
            <button type="button" onClick={() => selectPeriod(rangeProblem.suggest.start, rangeProblem.suggest.end)} className={btnGhost}>
              Open {rangeProblem.suggest.label ?? `${rangeProblem.suggest.start} – ${rangeProblem.suggest.end}`}
            </button>
          )}
        </div>
      )}

      {/* Filing status */}
      {filed ? (
        <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                  {filing.status === 'AMENDED' ? 'Amended return recorded' : 'Return filed'}
                  <FilingStatusBadge status={filing.status} />
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {RETURN_TYPE_LABELS[filing.returnType] ?? filing.returnType} · submitted {fmtDay(filing.filedAt)}
                  {filing.filedBy?.name ? ` · recorded by ${filing.filedBy.name}` : ''}
                  {filing.acknowledgementNo ? ` · ack ${filing.acknowledgementNo}` : ' · no acknowledgement no. yet'}
                </p>
                {filing.attachmentUrl && (
                  <a href={filing.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <Paperclip className="w-3 h-3" /> Return copy
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {hasSnapshot && (
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                  {[{ v: 'filed', l: 'As filed' }, { v: 'live', l: 'Live ledger' }].map(o => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setView(o.v)}
                      className={cn('px-3 py-1.5 text-xs font-medium rounded-md', view === o.v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800')}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              )}
              {perms.canFile && (
                <button type="button" onClick={() => setEditFiling(filing)} className={btnGhost}>Acknowledgement</button>
              )}
            </div>
          </div>
          {drift.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">
                  {carryDrift
                    ? 'The balance brought forward from the earlier return changed after this return was filed.'
                    : 'The tax ledger changed after this return was filed.'}
                </p>
                <ul className="mt-1 text-xs space-y-0.5">
                  {drift.map(d => (
                    <li key={d.key}>{d.label}: filed Tk {fmtAmount(d.filed)} → now Tk {fmtAmount(d.live)}</li>
                  ))}
                </ul>
                {carryDrift ? (
                  <p className="text-xs mt-1">
                    The earlier return was amended (or filed / its opening balance changed) after this one. Submit an amended return (s.66) for this
                    period with “File amended return”, then amend each later filed return in turn so the corrected balance reaches them.
                  </p>
                ) : (
                  <p className="text-xs mt-1">If the change belongs to this period, submit an amended return (s.66) and record it with “File amended return”.</p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : filing?.status === 'DRAFT' ? (
        <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <Receipt className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Draft in progress — {filing.challans?.length || 0} challan(s) saved{filing.notes ? ` · ${filing.notes}` : ''}. Not filed yet.</span>
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
