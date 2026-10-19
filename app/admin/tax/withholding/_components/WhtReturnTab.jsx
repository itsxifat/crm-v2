'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, ClipboardCheck, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import EmptyState from '@/components/ui/EmptyState'
import { TaxPill, DaysLeftBadge } from '@/components/tax/TaxBadges'
import { useTaxData } from '@/components/tax/useTaxData'
import {
  tk, fmtDay, btnPrimary, btnGhost, cardCls, inputCls, labelCls, hintCls, fetchJson, todayKey, payeeTypeLabel,
} from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

function FileReturnModal({ open, onOpenChange, quarter, filing, pending, onSaved }) {
  const [filedAt, setFiledAt] = useState(todayKey())
  const [ack, setAck] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const amend = !!filing && ['FILED', 'AMENDED'].includes(filing.status)

  useEffect(() => {
    if (!open) return
    setFiledAt(todayKey()); setAck(''); setNotes(''); setFile(null); setError(null)
  }, [open])

  async function submit() {
    if (!filedAt) return setError('Enter the filing date')
    setSaving(true)
    setError(null)
    try {
      const json = await fetchJson('/api/tax/withholding-return', {
        method: 'POST',
        body: { quarter: quarter.key, filedAt, acknowledgementNo: ack || null, notes: notes || null, attachmentUrl: file, amend },
      })
      toast.success(`Withholding return for ${quarter.label} recorded as ${amend ? 'amended' : 'filed'}`)
      for (const w of json.warnings ?? []) toast(w, { duration: 6000 })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`${amend ? 'Amend' : 'Record'} withholding return — ${quarter?.label ?? ''}`} description="Record the return you submitted to the tax office (s.177). The figures are frozen as filed." size="md">
      <div className="space-y-4 mb-4">
        {pending > 0.005 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {tk(pending)} deducted in this quarter is not yet deposited. Deposit it before filing.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Filing date *</label>
            <DatePicker value={filedAt} onChange={setFiledAt} clearable={false} />
            {quarter && <p className={hintCls}>Due {fmtDay(quarter.dueDate)}</p>}
          </div>
          <div>
            <label className={labelCls}>Acknowledgement no.</label>
            <input className={inputCls} value={ack} onChange={e => setAck(e.target.value)} maxLength={80} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} />
        </div>
        <FileUpload value={file} onUploaded={setFile} label="Return / acknowledgement copy" bucket="tax" />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <ModalFooter>
        <button type="button" className={btnGhost} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
          {amend ? 'Record amended return' : 'Record as filed'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

/** Quarterly withholding tax return (s.177): section-wise summary + payee lines. */
export default function WhtReturnTab({ initialQuarter = null }) {
  const { can } = usePermission()
  const [quarter, setQuarter] = useState(initialQuarter)
  const { data, loading, error, reload } = useTaxData(`/api/tax/withholding-return${quarter ? `?quarter=${encodeURIComponent(quarter)}` : ''}`)
  const [showPayees, setShowPayees] = useState(true)
  const [fileOpen, setFileOpen] = useState(false)

  const q = data?.quarter
  const filed = data?.filing && ['FILED', 'AMENDED'].includes(data.filing.status)
  const csvHref = q ? `/api/tax/withholding-return?quarter=${encodeURIComponent(q.key)}&format=csv` : null
  const quarterOptions = [...(data?.quarters ?? [])]
  if (q && !quarterOptions.some(o => o.key === q.key)) quarterOptions.unshift({ key: q.key, label: `${q.label} (FY ${q.fy} Q${q.q})` })

  return (
    <div className="space-y-4">
      <div className={cn(cardCls, 'p-4')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{q ? `${q.label} · FY ${q.fy} Q${q.q}` : 'Withholding tax return'}</h3>
              {q && (filed
                ? <TaxPill label={data.filing.status === 'AMENDED' ? 'Amended' : 'Filed'} color="green" />
                : q.ended ? <DaysLeftBadge daysLeft={q.daysLeft} /> : <TaxPill label="Quarter in progress" color="gray" dot={false} />)}
            </div>
            {q && (
              <p className="mt-0.5 text-xs text-gray-500">
                Due {fmtDay(q.dueDate)} (Tofsil-4, s.177)
                {filed && ` · filed ${fmtDay(data.filing.filedAt)}${data.filing.acknowledgementNo ? ` · ack. ${data.filing.acknowledgementNo}` : ''}${data.filing.returnType === 'LATE' ? ' · late' : ''}`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={cn(inputCls, 'w-auto py-1.5')} value={q?.key ?? ''} onChange={e => setQuarter(e.target.value)} aria-label="Quarter">
              {quarterOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            {csvHref && <a href={csvHref} className={btnGhost}><Download className="w-4 h-4" /> CSV</a>}
            {q?.ended && can('tax.returns.file') && (
              <button type="button" className={btnPrimary} onClick={() => setFileOpen(true)}>
                <ClipboardCheck className="w-4 h-4" /> {filed ? 'Amend' : 'Mark as filed'}
              </button>
            )}
            <button type="button" className={btnGhost} onClick={reload} aria-label="Refresh"><RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /></button>
          </div>
        </div>
        {data && (
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <div><dt className="text-xs text-gray-500">Payees</dt><dd className="font-semibold text-gray-900">{data.totals.payeeCount}</dd></div>
            <div><dt className="text-xs text-gray-500">Payments</dt><dd className="font-semibold text-gray-900">{data.totals.count}</dd></div>
            <div><dt className="text-xs text-gray-500">Amount paid</dt><dd className="font-semibold text-gray-900">{tk(data.totals.base)}</dd></div>
            <div><dt className="text-xs text-gray-500">Tax deducted</dt><dd className="font-semibold text-gray-900">{tk(data.totals.deducted)}</dd></div>
            <div>
              <dt className="text-xs text-gray-500">Not deposited</dt>
              <dd className={cn('font-semibold', data.totals.pending > 0.005 ? 'text-red-700' : 'text-gray-900')}>{tk(data.totals.pending)}</dd>
            </div>
          </dl>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className={cardCls}>
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Section-wise summary</h3>
        </div>
        {loading && !data ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
        ) : !data?.sections?.length ? (
          <EmptyState icon={FileText} title="No TDS deducted in this quarter" description="If the company made no payments subject to withholding, a nil return may still be required — check with your tax adviser." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-3 text-left font-semibold">Section</th>
                  <th className="px-3 py-3 text-left font-semibold">Nature of payment</th>
                  <th className="px-3 py-3 text-right font-semibold">Payees</th>
                  <th className="px-3 py-3 text-right font-semibold">Payments</th>
                  <th className="px-3 py-3 text-right font-semibold">Amount paid</th>
                  <th className="px-3 py-3 text-right font-semibold">Tax deducted</th>
                  <th className="px-3 py-3 text-right font-semibold">Deposited</th>
                  <th className="px-3 py-3 text-left font-semibold">Challans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.sections.map(s => (
                  <tr key={s.code ?? 'none'}>
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className="font-medium text-gray-900">s.{s.section}</span> <span className="font-mono text-[11px] text-gray-400">{s.code}</span></td>
                    <td className="px-3 py-2.5 text-gray-700 min-w-[200px]">{s.label}</td>
                    <td className="px-3 py-2.5 text-right">{s.payeeCount}</td>
                    <td className="px-3 py-2.5 text-right">{s.count}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{tk(s.base)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold text-gray-900">{tk(s.deducted)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {tk(s.deposited)}
                      {s.pending > 0.005 && <span className="block text-[11px] text-red-600">{tk(s.pending)} pending</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-gray-500 max-w-[220px]">{s.challans.join(', ') || '—'}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50/70 font-semibold text-gray-900">
                  <td className="px-3 py-2.5" colSpan={2}>Total</td>
                  <td className="px-3 py-2.5 text-right">{data.totals.payeeCount}</td>
                  <td className="px-3 py-2.5 text-right">{data.totals.count}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">{tk(data.totals.base)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">{tk(data.totals.deducted)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">{tk(data.totals.deposited)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{data.totals.challanCount} challan{data.totals.challanCount === 1 ? '' : 's'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data?.payees?.length > 0 && (
        <div className={cardCls}>
          <button type="button" onClick={() => setShowPayees(s => !s)} className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 text-left">
            <h3 className="text-sm font-semibold text-gray-900">Payee-wise details ({data.payees.length})</h3>
            {showPayees ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showPayees && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60 text-xs uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-3 text-left font-semibold">Section</th>
                    <th className="px-3 py-3 text-left font-semibold">Payee</th>
                    <th className="px-3 py-3 text-left font-semibold">TIN</th>
                    <th className="px-3 py-3 text-right font-semibold">Payments</th>
                    <th className="px-3 py-3 text-right font-semibold">Amount paid</th>
                    <th className="px-3 py-3 text-right font-semibold">Tax deducted</th>
                    <th className="px-3 py-3 text-right font-semibold">Deposited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.payees.map((p, i) => (
                    <tr key={`${p.code}-${p.partyName}-${i}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">s.{p.section} <span className="font-mono text-[11px] text-gray-400">{p.code}</span></td>
                      <td className="px-3 py-2 min-w-[160px]">
                        <p className="font-medium text-gray-900">{p.partyName}</p>
                        <p className="text-[11px] text-gray-500">{payeeTypeLabel(p.payeeType)}{p.higherRateCount ? ` · ${p.higherRateCount} at higher rate` : ''}</p>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-600">{p.partyTin || <span className="text-amber-700 font-sans">missing</span>}</td>
                      <td className="px-3 py-2 text-right">{p.count}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{tk(p.base)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-medium text-gray-900">{tk(p.deducted)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{tk(p.deposited)}{p.pending > 0.005 && <span className="block text-[11px] text-red-600">{tk(p.pending)} pending</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {q && <FileReturnModal open={fileOpen} onOpenChange={setFileOpen} quarter={q} filing={data?.filing} pending={data?.totals?.pending ?? 0} onSaved={reload} />}
    </div>
  )
}
