'use client'

import { useEffect, useState } from 'react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

/** Yes/no confirmation. `onConfirm` may return a promise; the dialog stays busy until it settles. */
export default function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', danger = false, onConfirm,
}) {
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!open) setBusy(false) }, [open])

  const run = async () => {
    setBusy(true)
    try {
      await onConfirm?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(v) => !busy && onOpenChange(v)} title={title} description={description} size="sm">
      <ModalFooter className="mt-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'destructive' : 'default'} onClick={run} loading={busy}>{confirmLabel}</Button>
      </ModalFooter>
    </Modal>
  )
}
