'use client'

import { useEffect, useState } from 'react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Label, Textarea } from '@/components/ui/Input'
import { FOOTER_STICKY } from './accountTheme'

/** Small red helper line under a field. */
export function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1.5 text-xs text-red-600">{message}</p>
}

/** Simple yes/no confirmation. `onConfirm` may return a promise; the dialog shows a spinner meanwhile. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', danger = false, onConfirm, children,
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
      {children && <div className="space-y-2 text-sm text-gray-600">{children}</div>}
      <ModalFooter className={FOOTER_STICKY}>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'destructive' : 'default'} onClick={run} loading={busy}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** Confirmation that requires a written reason (audit trail). */
export function ReasonDialog({
  open, onOpenChange, title, description, label = 'Reason', placeholder = 'Why?', minLength = 5,
  confirmLabel = 'Confirm', danger = false, onConfirm, children,
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (open) { setReason(''); setTouched(false); setBusy(false) }
  }, [open])
  const tooShort = reason.trim().length < minLength
  const run = async () => {
    setTouched(true)
    if (tooShort) return
    setBusy(true)
    try {
      await onConfirm?.(reason.trim())
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onOpenChange={(v) => !busy && onOpenChange(v)} title={title} description={description} size="md">
      <div className="space-y-4">
        {children}
        <div>
          <Label htmlFor="finance-reason" required>{label}</Label>
          <Textarea
            id="finance-reason"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={placeholder}
            invalid={touched && tooShort}
            className="resize-none"
          />
          {touched && tooShort && <FieldError message={`Write at least ${minLength} characters`} />}
        </div>
      </div>
      <ModalFooter className={FOOTER_STICKY}>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'destructive' : 'default'} onClick={run} loading={busy}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
