'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Lock, LockOpen, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import { Label, Textarea } from '@/components/ui/Input'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { cn, formatDateTime } from '@/lib/utils'
import PositionCard from './PositionCard'
import { Callout, apiFetch } from './shared'

const CHECK_ICON = {
  error:   { Icon: XCircle,       cls: 'text-red-600' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-600' },
  info:    { Icon: Info,          cls: 'text-blue-600' },
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
      description={unlocking ? 'The reason is kept in the audit trail.' : "Opening figures and the go-live date can't change after this."}
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
            Anyone with “Manage opening balances” can edit again — re-lock once the correction is done.
          </Callout>
        )}
        <div>
          <Label htmlFor="lock-reason" required={unlocking}>
            {unlocking ? 'Reason' : 'Note'}
          </Label>
          <Textarea
            id="lock-reason"
            rows={3}
            value={reason}
            maxLength={500}
            onChange={e => setReason(e.target.value)}
            placeholder={unlocking ? 'e.g. Auditor adjusted the AIT credit' : 'e.g. Agreed with the trial balance'}
          />
          {unlocking && tooShort && reason.length > 0 && <p className="mt-1.5 text-xs text-red-600">At least 10 characters.</p>}
        </div>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={unlocking ? 'destructive' : 'default'} onClick={confirm} loading={busy} disabled={tooShort}>
          {!busy && (unlocking ? <LockOpen /> : <Lock />)}
          {unlocking ? 'Unlock' : 'Lock opening balances'}
        </Button>
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
      <Card className="space-y-4 p-5 sm:p-6">
        <div>
          <CardTitle as="h2">Review &amp; lock</CardTitle>
          <CardDescription>
            Compare with your trial balance{data.asOfDate ? ` at ${dayKeyLabel(data.asOfDate)}` : ''}
          </CardDescription>
        </div>

        {data.openingLocked ? (
          <Callout tone="success" title="Opening balances are locked" icon={Lock}>
            Locked{data.openingLockedBy?.name ? ` by ${data.openingLockedBy.name}` : ''}{data.openingLockedAt ? ` on ${formatDateTime(data.openingLockedAt)}` : ''}; correct with normal entries or a super-admin unlock.
          </Callout>
        ) : (
          <Callout tone="info" title="Not locked yet">
            Lock once the figures agree with your books.
          </Callout>
        )}

        {dirty && (
          <Callout tone="warning">Unsaved money-account changes in step 2 — save or discard them before locking.</Callout>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Checklist</h3>
          {checks.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> Everything looks complete.</p>
          ) : (
            <ul className="space-y-1.5">
              {checks.map((c, i) => {
                const { Icon, cls } = CHECK_ICON[c.level] ?? CHECK_ICON.info
                return (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <Icon className={cn('mt-0.5 size-4 shrink-0', cls)} />
                    <span className="min-w-0">
                      {c.message}
                      {c.step && c.step !== 5 && (
                        <button type="button" className="ml-1.5 text-xs font-medium text-gray-900 underline underline-offset-4" onClick={() => goToStep?.(c.step)}>
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

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
          {data.openingLocked
            ? meta?.canUnlock && (
              <Button variant="outline" onClick={() => openLock('unlock')}>
                <LockOpen /> Unlock (super admin)
              </Button>
            )
            : meta?.canManage && (
              <Button onClick={() => openLock('lock')} disabled={blocking.length > 0 || dirty}>
                <Lock /> Lock opening balances
              </Button>
            )}
        </div>
        {!data.openingLocked && blocking.length > 0 && (
          <p className="text-right text-xs text-red-600">{blocking[0].message}</p>
        )}
      </Card>

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
