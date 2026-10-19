'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, FOOTER_STICKY, INPUT, LABEL } from './accountTheme'

/** Small red helper line under a field. */
export function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
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
      <div className="flex gap-3">
        {danger && (
          <span className="w-9 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </span>
        )}
        <div className="text-sm text-gray-600 space-y-2 self-center">
          {children ?? <p>{danger ? 'Please confirm to continue.' : 'Continue?'}</p>}
        </div>
      </div>
      <ModalFooter className={FOOTER_STICKY}>
        <button type="button" className={BTN_SECONDARY} onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
        <button type="button" className={danger ? BTN_DANGER : BTN_PRIMARY} onClick={run} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {confirmLabel}
        </button>
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
          <label className={LABEL} htmlFor="finance-reason">{label} <span className="text-red-500">*</span></label>
          <textarea
            id="finance-reason"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={placeholder}
            className={cn(INPUT, 'resize-none')}
          />
          {touched && tooShort && <FieldError message={`Please write at least ${minLength} characters`} />}
        </div>
      </div>
      <ModalFooter className={FOOTER_STICKY}>
        <button type="button" className={BTN_SECONDARY} onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
        <button type="button" className={danger ? BTN_DANGER : BTN_PRIMARY} onClick={run} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {confirmLabel}
        </button>
      </ModalFooter>
    </Modal>
  )
}
