'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Ban } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Input'
import { num, qtyText } from './billMath'

/** Cancel a DRAFT or RECEIVED bill (POST /api/inventory/purchases/[id]/cancel). */
export default function CancelBillDialog({ open, onOpenChange, bill, onDone }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) { setReason(''); setError(null) }
  }, [open])

  if (!bill) return null
  const received = bill.status === 'RECEIVED'
  const assetCount = (bill.lines ?? []).reduce((s, l) => s + (l.assets?.length ?? l.assetIds?.length ?? 0), 0)
  const stockLines = (bill.lines ?? []).filter(l => l.lineType === 'CONSUMABLE' && l.stockMovementId)
  const pendingRequest = bill.payment?.status === 'REQUESTED'
  const tooShort = received && reason.trim().length < 5

  async function submit() {
    if (tooShort) { setError('Give a reason (at least 5 characters)'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/purchases/${bill.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Couldn't cancel the bill")
      toast.success(`${bill.billNo} cancelled`)
      for (const w of json.warnings ?? []) toast(w, { duration: 8000 })
      onDone?.(json.data)
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v) }} title={`Cancel ${bill.billNo}?`}
      description={received ? 'Undo the receipt of this bill.' : 'The draft is kept as a cancelled record.'} size="md">
      <div className="space-y-4">
        {received && (
          <div className="space-y-2 rounded-lg bg-gray-50 px-3.5 py-3 text-sm text-gray-700">
            <ul className="list-disc space-y-1 pl-4">
              {assetCount > 0 && <li>{assetCount} asset{assetCount === 1 ? '' : 's'} from this bill will be deleted (tags aren&apos;t reused).</li>}
              {stockLines.length > 0 && (
                <li>Stock is taken back out: {stockLines.map(l => `${qtyText(num(l.qty))} ${l.unit || 'pcs'} ${l.stockItem?.name ?? l.description}`).join(', ')}.</li>
              )}
              {pendingRequest && <li>The payment request in Accounts is rejected.</li>}
            </ul>
            <p className="text-xs text-muted-foreground">Only while assets are untouched, stock is on hand and nothing is paid.</p>
          </div>
        )}
        <Field label="Reason" required={received}>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
            placeholder="e.g. Wrong model delivered, returned" />
        </Field>
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Keep bill</Button>
        <Button variant="destructive" onClick={submit} loading={saving} disabled={tooShort}>
          {!saving && <Ban />} Cancel bill
        </Button>
      </ModalFooter>
    </Modal>
  )
}
