'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Ban, AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Textarea, Field } from '@/components/ui/Input'
import { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { tk, entryTypeLabel, fetchJson } from './taxUi'

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
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {isDeposit
              ? 'Reverses the challan payment (dated today); settled deductions go back to "To deposit".'
              : 'Stays in the ledger as void; excluded from returns, registers and certificates.'}
          </span>
        </div>
        <Field label="Reason" required error={error || undefined}>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="e.g. Duplicate of TAX-2610-00012" invalid={!!error} />
        </Field>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={saving}>Cancel</Button>
        <Button variant="destructive" onClick={submit} loading={saving}>
          {!saving && <Ban />}
          Void entry
        </Button>
      </ModalFooter>
    </Modal>
  )
}
