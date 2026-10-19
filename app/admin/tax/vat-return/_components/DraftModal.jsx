'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import ChallansEditor, { challanToRow, rowsToPayload, challanProblem } from './ChallansEditor'
import { readJson, inputCls, labelCls, btnPrimary, btnGhost } from '../_lib/format'

/**
 * Save treasury challans / refund request / notes on a DRAFT return so they
 * count in notes 58 (VAT) / 59 (SD) / 67 while the return is being prepared.
 */
export default function DraftModal({ open, onClose, period, filing, settings, onSaved }) {
  const [challans, setChallans] = useState([])
  const [refund, setRefund] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setChallans((filing?.challans ?? []).map(challanToRow))
    setRefund(filing?.refundRequested ? String(filing.refundRequested) : '')
    setNotes(filing?.notes ?? '')
    setError(null)
  }, [open, filing])

  async function save() {
    const problem = challanProblem(challans)
    if (problem) { setError(problem); return }
    if (refund !== '' && !(Number(refund) >= 0)) { setError('Refund requested must be 0 or more'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tax/vat-return/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: period.start,
          end: period.end,
          challans: rowsToPayload(challans),
          refundRequested: refund === '' ? 0 : Number(refund),
          notes: notes.trim() || null,
        }),
      })
      const json = await readJson(res)
      toast.success('Draft saved')
      onSaved?.(json.data)
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
      title="Challans & draft notes"
      description={period ? `${period.label} — saved as a draft until the return is filed` : undefined}
      size="lg"
    >
      <div className="space-y-5">
        <p className="text-sm text-gray-600">
          Record the treasury challans (A-challan / e-payment) paid for this return. They are added to note 58 (VAT)
          or note 59 (supplementary duty, choose “SD”). A challan already recorded as a VAT payment in the tax ledger
          is counted once (matched by challan number).
        </p>
        <ChallansEditor
          rows={challans}
          onChange={setChallans}
          defaultAccountCode={settings?.challanCode ?? ''}
          sdAccountCode={settings?.sdChallanCode ?? ''}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Refund requested (note 67)</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={refund} onChange={e => setRefund(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Working notes</label>
          <textarea rows={3} className={`${inputCls} resize-none`} value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
        <button type="button" onClick={onClose} disabled={saving} className={btnGhost}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save draft
        </button>
      </ModalFooter>
    </Modal>
  )
}
