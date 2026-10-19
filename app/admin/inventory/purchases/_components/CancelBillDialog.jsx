'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Ban, Loader2 } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
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
      if (!res.ok) throw new Error(json.error || 'Could not cancel the bill')
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
          <ul className="space-y-1.5 text-sm text-gray-700">
            {assetCount > 0 && <li>• {assetCount} asset{assetCount === 1 ? '' : 's'} created from this bill will be deleted (their tags are not reused).</li>}
            {stockLines.length > 0 && (
              <li>• Stock is taken back out: {stockLines.map(l => `${qtyText(num(l.qty))} ${l.unit || 'pcs'} ${l.stockItem?.name ?? l.description}`).join(', ')}.</li>
            )}
            {pendingRequest && <li>• The payment request in Accounts is rejected.</li>}
            <li className="text-gray-500">Only possible while the assets are untouched, the stock is still on hand and nothing is paid.</li>
          </ul>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Reason {received ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal">(optional)</span>}
          </label>
          <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            placeholder="e.g. Supplier delivered the wrong model — returned" />
        </div>
        {error && (
          <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </div>
      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 bg-white">
          Keep bill
        </button>
        <button type="button" onClick={submit} disabled={saving || tooShort}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
          Cancel bill
        </button>
      </ModalFooter>
    </Modal>
  )
}
