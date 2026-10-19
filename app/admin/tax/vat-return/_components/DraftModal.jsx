'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, Textarea, Field } from '@/components/ui/Input'
import ChallansEditor, { challanToRow, rowsToPayload, challanProblem } from './ChallansEditor'
import { readJson } from '../_lib/format'

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
      description={period ? `${period.label} · draft until filed` : undefined}
      size="lg"
    >
      <div className="space-y-5">
        <p className="text-[13px] text-muted-foreground">
          Counted in note 58 (VAT) or 59 (SD). Challans already in the tax ledger count once.
        </p>
        <ChallansEditor
          rows={challans}
          onChange={setChallans}
          defaultAccountCode={settings?.challanCode ?? ''}
          sdAccountCode={settings?.sdChallanCode ?? ''}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Refund requested (note 67)">
            <Input type="number" min="0" step="0.01" value={refund} onChange={e => setRefund(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Working notes">
          <Textarea rows={3} className="resize-none" value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} />
        </Field>
        {error && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
            <p>{error}</p>
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving}>Save draft</Button>
      </ModalFooter>
    </Modal>
  )
}
