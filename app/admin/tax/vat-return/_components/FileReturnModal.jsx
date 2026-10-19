'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Lock, Loader2 } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { periodLastDay } from '@/lib/finance/fiscal'
import ChallansEditor, { challanToRow, rowsToPayload, challanProblem, challanTotals } from './ChallansEditor'
import {
  fmtAmount, fmtDay, todayKey, toNum, round2, readJson, RETURN_TYPE_OPTIONS,
  inputCls, labelCls, btnPrimary, btnGhost,
} from '../_lib/format'

function defaultReturnType(filed, dueDate) {
  if (filed) return 'AMENDED'
  return dueDate && todayKey() > dueDate ? 'LATE' : 'ORIGINAL'
}

/**
 * File (or amend) the Mushak-9.1 for the selected period: return type,
 * acknowledgement no., submission date, treasury challans, refund request.
 */
export default function FileReturnModal({ open, onClose, period, result, filing, settings, onFiled }) {
  const filed = !!filing && ['FILED', 'AMENDED'].includes(filing.status)
  const [returnType, setReturnType] = useState('ORIGINAL')
  const [ackNo, setAckNo] = useState('')
  const [filedAt, setFiledAt] = useState(todayKey())
  const [challans, setChallans] = useState([])
  const [refund, setRefund] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setReturnType(defaultReturnType(filed, period?.dueDate))
    setAckNo('')
    setFiledAt(todayKey())
    setChallans((filing?.challans ?? []).map(challanToRow))
    setRefund(filing?.refundRequested ? String(filing.refundRequested) : '')
    setNotes('')
    setConfirmed(false)
    setError(null)
  }, [open, filed, filing, period?.dueDate])

  const notes50 = toNum(result?.notes?.[50])
  const notes51 = toNum(result?.notes?.[51])
  const n35 = toNum(result?.notes?.[35])
  // Ledger deposits by head: VAT lines (note 58) and SD (note 59 lines, plus any SD on a VAT line).
  const ledger = useMemo(() => {
    const rows = (result?.lines?.deposits ?? []).filter(l => l.source !== 'CHALLAN')
    return {
      vat: round2(rows.filter(l => Number(l.note ?? 58) !== 59).reduce((s, l) => s + toNum(l.amount), 0)),
      sd:  round2(rows.reduce((s, l) => s + (Number(l.note) === 59 ? toNum(l.amount) : toNum(l.sd)), 0)),
    }
  }, [result])
  const ledgerDeposits = ledger.vat
  const enteredByHead = challanTotals(challans)
  const entered = enteredByHead.VAT
  const deposits = round2(ledgerDeposits + entered)
  const shortfall = round2(Math.max(0, notes50 - deposits))
  // Same as lib/tax/vatReturn: closing balance before refund = 58 − (35 + 41 + 43 + 44).
  const net50 = round2(n35 + toNum(result?.notes?.[41]) + toNum(result?.notes?.[43]) + toNum(result?.notes?.[44]))
  const closing = round2(Math.max(0, deposits - net50))
  // Supplementary duty: 51 = 37 + 42 (0 when negative), deposited by its own challan (note 59).
  const sdDeposits = round2(ledger.sd + enteredByHead.SD)
  const sdShortfall = round2(Math.max(0, notes51 - sdDeposits))
  const net51 = round2(toNum(result?.notes?.[37]) + toNum(result?.notes?.[42]))
  const sdClosing = round2(Math.max(0, sdDeposits - net51))
  const showSd = notes51 > 0.005 || sdDeposits > 0.005 || toNum(result?.notes?.[53]) > 0.005
  const lastDay = period ? periodLastDay(period.end) : null
  const periodEnded = lastDay ? todayKey() > lastDay : false

  function validate() {
    if (!periodEnded) return `${period?.label} has not ended yet — file after ${fmtDay(lastDay)}`
    if (!filedAt) return 'Enter the submission date'
    if (filedAt <= lastDay) return 'The submission date must be after the end of the tax period'
    if (filedAt > todayKey()) return 'The submission date cannot be in the future'
    if (filed && returnType !== 'AMENDED') return 'This return is already filed — choose "Amended (s.66)"'
    if (!filed && returnType === 'AMENDED') return 'There is no filed return to amend — choose "Original (s.64)" or "Late (s.65)"'
    const cp = challanProblem(challans)
    if (cp) return cp
    if (refund !== '' && (!(Number(refund) >= 0))) return 'Refund requested must be 0 or more'
    if (toNum(refund) > closing + 0.005) return `Refund requested cannot exceed the closing balance (Tk ${fmtAmount(closing)})`
    if (!confirmed) return 'Confirm that the return has been submitted on the NBR eVAT portal'
    return null
  }

  async function submit() {
    const problem = validate()
    if (problem) { setError(problem); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tax/vat-return/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: period.start,
          end: period.end,
          returnType,
          acknowledgementNo: ackNo.trim() || null,
          filedAt,
          challans: rowsToPayload(challans),
          refundRequested: refund === '' ? 0 : Number(refund),
          notes: notes.trim() || null,
        }),
      })
      const json = await readJson(res)
      toast.success(json.amended ? 'Amended return recorded' : 'VAT return filed')
      // Later filed returns brought forward the old closing balance — they need amending too.
      if (json.warning) toast(json.warning, { duration: 15000 })
      onFiled?.(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v && !saving) onClose() }}
      title={filed ? 'File amended VAT return' : 'File VAT return (Mushak-9.1)'}
      description={period ? `${period.label} · due ${fmtDay(period.dueDate)}` : undefined}
      size="lg"
    >
      <div className="space-y-5">
        {filed && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>This period was filed on {fmtDay(filing.filedAt)}. An amended return (s.66) replaces the recorded figures; the earlier version is kept in the history.</p>
          </div>
        )}

        {/* Figures */}
        <div className="rounded-xl border border-gray-100 overflow-hidden text-sm">
          <Row label="Net payable VAT for treasury deposit (note 50)" value={notes50} strong />
          <Row label="Deposits recorded in the tax ledger" value={ledgerDeposits} />
          <Row label="Challans entered below" value={entered} />
          <Row label="Treasury deposits (note 58)" value={deposits} />
          {shortfall > 0.005
            ? <Row label="Still to pay before submitting" value={shortfall} tone="red" strong />
            : <Row label="Closing balance carried forward (note 65)" value={closing} tone="green" strong />}
          {showSd && (
            <>
              <Row label="Net payable SD for treasury deposit (note 51)" value={notes51} strong />
              <Row label="SD deposits (note 59)" value={sdDeposits} />
              {sdShortfall > 0.005
                ? <Row label="SD still to pay before submitting" value={sdShortfall} tone="red" strong />
                : <Row label="SD closing balance carried forward (note 66)" value={sdClosing} tone="green" strong />}
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Return type</label>
            <select className={inputCls} value={returnType} onChange={e => setReturnType(e.target.value)}>
              {RETURN_TYPE_OPTIONS.map(o => (
                // Filed ⇒ only an amendment; not filed ⇒ there is nothing to amend yet.
                <option key={o.value} value={o.value} disabled={filed ? o.value !== 'AMENDED' : o.value === 'AMENDED'}>{o.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Late (s.65) applies after the due date; interest and penalty go in notes 41/43.</p>
          </div>
          <div>
            <label className={labelCls}>Submission date</label>
            <input type="date" className={inputCls} value={filedAt} max={todayKey()} onChange={e => setFiledAt(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>eVAT acknowledgement / submission no.</label>
            <input className={inputCls} value={ackNo} maxLength={80} onChange={e => setAckNo(e.target.value)} placeholder="From the eVAT portal (can be added later)" />
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-900">Treasury challans (notes 58 / 59)</p>
          <p className="text-xs text-gray-500 mb-3">
            Add challans paid for this return that are not yet recorded as VAT payments in the tax ledger.
            VAT account code: <span className="font-mono">{settings?.challanCode || '1/1133/0010/0311'}</span> (A-challan: <span className="font-mono">{settings?.challanCodeNew || '1141101'}</span>).
            {showSd && <> Supplementary duty is paid separately (choose “SD”): <span className="font-mono">{settings?.sdChallanCode || '1/1133/0010/0721'}</span> (A-challan: <span className="font-mono">{settings?.sdChallanCodeNew || '1141103'}</span>).</>}
          </p>
          <ChallansEditor rows={challans} onChange={setChallans} defaultAccountCode={settings?.challanCode ?? ''} sdAccountCode={settings?.sdChallanCode ?? ''} />
        </div>

        {closing > 0.005 && (
          <div>
            <label className={labelCls}>Refund requested (note 67)</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={refund} onChange={e => setRefund(e.target.value)} placeholder="0.00" />
            <p className="text-[11px] text-gray-400 mt-1">Up to Tk {fmtAmount(closing)}. What is not refunded is carried forward to the next return (note 52).</p>
          </div>
        )}

        <div>
          <label className={labelCls}>Notes</label>
          <textarea rows={2} className={`${inputCls} resize-none`} value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
          <Lock className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
          <p>Filing freezes these figures, marks the input VAT and VDS certificates as claimed in this return and locks VAT entries dated up to {fmtDay(lastDay)}.</p>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          <span>I confirm this return has been submitted on the NBR eVAT portal (vat.gov.bd) with these figures.</span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
        <button type="button" onClick={onClose} disabled={saving} className={btnGhost}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {filed ? 'Record amended return' : 'Record filing'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

function Row({ label, value, strong, tone }) {
  const color = tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-emerald-700' : 'text-gray-900'
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2 border-b border-gray-50 last:border-0 ${strong ? 'bg-gray-50' : ''}`}>
      <span className="text-gray-600">{label}</span>
      <span className={`tabular-nums whitespace-nowrap ${strong ? 'font-semibold' : ''} ${color}`}>Tk {fmtAmount(value)}</span>
    </div>
  )
}
