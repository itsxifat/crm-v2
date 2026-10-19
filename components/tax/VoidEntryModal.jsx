'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Ban, Loader2, AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { inputCls, labelCls, btnDanger, btnGhost, tk, entryTypeLabel, fetchJson } from './taxUi'

const DEPOSIT_TYPES = ['TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX']

/** Void a tax entry with a reason. Deposits also reverse their money rows. */
export default function VoidEntryModal({ open, onOpenChange, entry, onSaved }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) { setReason(''); setError(null) }
  }, [open])

  const isDeposit = DEPOSIT_TYPES.includes(entry?.entryType)

  async function submit() {
    if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)')
    setSaving(true)
    setError(null)
    try {
      const json = await fetchJson(`/api/tax/entries/${entry.id}`, { method: 'PUT', body: { action: 'void', reason: reason.trim() } })
      if (isDeposit) invalidateMoneyAccounts()
      toast.success(`${entry.entryNo} voided${json.reversals?.length ? ' and its payment reversed' : ''}`)
      for (const w of json.warnings ?? []) toast.error(w, { duration: 8000 })
      onSaved?.()
      onOpenChange?.(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!entry) return null
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Void ${entry.entryNo}`} description={`${entryTypeLabel(entry.entryType)} · ${tk(entry.amount)}`} size="sm">
      <div className="space-y-3 mb-4">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {isDeposit
              ? 'The challan payment is reversed in its money account (dated today) and any deductions it settled go back to "To deposit".'
              : 'The entry stays in the ledger marked void and is left out of returns, registers and certificates.'}
          </span>
        </div>
        <div>
          <label className={labelCls}>Reason *</label>
          <textarea rows={3} className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="e.g. Recorded twice — duplicate of TAX-2610-00012" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <ModalFooter>
        <button type="button" className={btnGhost} onClick={() => onOpenChange?.(false)} disabled={saving}>Cancel</button>
        <button type="button" className={btnDanger} onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
          Void entry
        </button>
      </ModalFooter>
    </Modal>
  )
}
