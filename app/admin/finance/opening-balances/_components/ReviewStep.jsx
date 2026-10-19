'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, Lock, LockOpen, ShieldCheck, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { cn, formatDateTime } from '@/lib/utils'
import PositionCard from './PositionCard'
import { Callout, apiFetch, btnDanger, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from './shared'

const CHECK_ICON = {
  error:   { Icon: XCircle,       cls: 'text-red-500' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-500' },
  info:    { Icon: Info,          cls: 'text-blue-500' },
}

function LockModal({ open, mode, onClose, onDone, warnings }) {
  // `mode` stays set while the dialog animates closed.
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const unlocking = mode === 'unlock'

  useEffect(() => { if (open) setReason('') }, [open])
  const tooShort = unlocking && reason.trim().length < 10

  async function confirm() {
    setBusy(true)
    try {
      const json = await apiFetch('/api/finance/opening-balances/lock', { method: 'POST', body: { action: mode, reason } })
      toast.success(unlocking ? 'Opening balances unlocked' : 'Opening balances locked')
      setReason('')
      onDone?.(json)
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={unlocking ? 'Unlock opening balances' : 'Lock opening balances'}
      description={unlocking ? 'Only a super admin can do this. The reason is kept in the audit trail.' : 'After locking, opening figures and the go-live date cannot be changed.'}
      size="md"
    >
      <div className="space-y-3">
        {!unlocking && warnings.length > 0 && (
          <Callout tone="warning" title={`${warnings.length} thing${warnings.length === 1 ? '' : 's'} to double-check`}>
            <ul className="list-disc pl-4 space-y-0.5">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </Callout>
        )}
        {unlocking && (
          <Callout tone="warning">
            Unlocking lets anyone with “Manage opening balances” change the go-live date and opening figures again. Re-lock as soon as the correction is done.
          </Callout>
        )}
        <div>
          <label className={labelCls} htmlFor="lock-reason">
            {unlocking ? 'Why are you unlocking? (at least 10 characters)' : 'Note (optional)'}
          </label>
          <textarea
            id="lock-reason"
            rows={3}
            className={inputCls}
            value={reason}
            maxLength={500}
            onChange={e => setReason(e.target.value)}
            placeholder={unlocking ? 'e.g. Auditor adjusted the AIT credit for FY 2025-26' : 'e.g. Agreed with the trial balance at 30 Jun 2026'}
          />
          {unlocking && tooShort && reason.length > 0 && <p className="text-xs text-red-600 mt-1">Give a little more detail.</p>}
        </div>
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={unlocking ? btnDanger : btnPrimary} onClick={confirm} disabled={busy || tooShort}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : unlocking ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {unlocking ? 'Unlock' : 'Lock opening balances'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

export default function ReviewStep({ data, meta, position, dirty, onLockChanged, goToStep }) {
  const [mode, setMode] = useState('lock')
  const [lockOpen, setLockOpen] = useState(false)
  const openLock = (m) => { setMode(m); setLockOpen(true) }
  const checks = data.checks ?? []
  const blocking = checks.filter(c => c.level === 'error')
  const warnings = checks.filter(c => c.level === 'warning').map(c => c.message)

  return (
    <div className="space-y-6">
      <div className={`${cardCls} p-4 sm:p-6 space-y-4`}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-900 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Step 5 — Review & lock</h2>
            <p className="text-sm text-gray-500">
              Compare the figures with your last balance sheet / trial balance{data.asOfDate ? ` at ${dayKeyLabel(data.asOfDate)}` : ''}, then lock them so they cannot change by accident.
            </p>
          </div>
        </div>

        {data.openingLocked ? (
          <Callout tone="success" title="Opening balances are locked" icon={Lock}>
            Locked{data.openingLockedBy?.name ? ` by ${data.openingLockedBy.name}` : ''}{data.openingLockedAt ? ` on ${formatDateTime(data.openingLockedAt)}` : ''}.
            Corrections after this are made as normal entries — or a super admin can unlock with a reason.
          </Callout>
        ) : (
          <Callout tone="info" title="Not locked yet">
            While open, anyone with “Manage opening balances” can change the go-live date and the figures. Lock once they agree with your books.
          </Callout>
        )}

        {dirty && (
          <Callout tone="warning">You have unsaved money-account changes in step 2 — save or discard them before locking.</Callout>
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Checklist</h3>
          {checks.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="w-4 h-4" /> Everything looks complete.</p>
          ) : (
            <ul className="space-y-1.5">
              {checks.map((c, i) => {
                const { Icon, cls } = CHECK_ICON[c.level] ?? CHECK_ICON.info
                return (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', cls)} />
                    <span className="min-w-0">
                      {c.message}
                      {c.step && c.step !== 5 && (
                        <button type="button" className="ml-1.5 text-xs font-medium text-gray-900 underline underline-offset-2" onClick={() => goToStep?.(c.step)}>
                          Go to step {c.step}
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-1">
          {data.openingLocked
            ? meta?.canUnlock && (
              <button type="button" className={btnGhost} onClick={() => openLock('unlock')}>
                <LockOpen className="w-4 h-4" /> Unlock (super admin)
              </button>
            )
            : meta?.canManage && (
              <button type="button" className={btnPrimary} onClick={() => openLock('lock')} disabled={blocking.length > 0 || dirty}>
                <Lock className="w-4 h-4" /> Lock opening balances
              </button>
            )}
        </div>
        {!data.openingLocked && blocking.length > 0 && (
          <p className="text-xs text-red-600 text-right">{blocking[0].message}</p>
        )}
      </div>

      <PositionCard position={position} tax={data.tax} asOfDate={data.asOfDate} dirty={dirty} detailed />

      <LockModal
        open={lockOpen}
        mode={mode}
        warnings={warnings}
        onClose={() => setLockOpen(false)}
        onDone={(json) => onLockChanged?.(json)}
      />
    </div>
  )
}
