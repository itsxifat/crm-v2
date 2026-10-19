'use client'

import Link from 'next/link'
import {
  ArrowLeftRight, PlusCircle, ListChecks, FileText, Pencil, Archive, ArchiveRestore, Trash2, Star,
  ShieldCheck, Clock, UserRound, AlertTriangle,
} from 'lucide-react'
import ActionMenu from '@/components/ui/ActionMenu'
import Badge from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import AccountIcon from './AccountIcon'
import { accountSubtitle, maskedNumber, formatAmount } from './accountTheme'

const QUICK_ACTION = 'inline-flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors outline-none hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:gap-1.5'

function QuickAction({ icon: Icon, label, onClick, href }) {
  const body = <><Icon className="size-4 shrink-0 text-gray-500" /><span className="truncate">{label}</span></>
  if (href) return <Link href={href} className={QUICK_ACTION}>{body}</Link>
  return <button type="button" onClick={onClick} className={QUICK_ACTION}>{body}</button>
}

/**
 * One money account as a card: identity, balance, cleared balance, reconciliation status, quick actions.
 */
export default function AccountCard({
  account, canManage, canReconcile, onTransfer, onMovement, onEdit, onArchive, onRestore, onDelete,
}) {
  const a = account
  const archived = a.status === 'ARCHIVED'
  const negative = a.balance < -0.004
  const number = maskedNumber(a)
  const href = `/admin/finance/accounts/${a.id}`
  const cash = a.type === 'CASH' || a.type === 'PETTY_CASH'
  const inProgress = a.reconciliationInProgress
  const deletable = a.txCount === 0 && Math.abs(Number(a.openingBalance) || 0) < 0.005

  const menu = [
    { label: 'View statement', icon: FileText, href },
    canReconcile && !archived && { label: inProgress ? 'Continue reconciliation' : 'Reconcile', icon: ListChecks, href: `${href}?tab=reconcile` },
    canManage && { label: 'Edit details', icon: Pencil, onClick: () => onEdit?.(a) },
    canManage && !archived && { label: 'Archive', icon: Archive, onClick: () => onArchive?.(a), danger: true },
    canManage && archived && { label: 'Restore', icon: ArchiveRestore, onClick: () => onRestore?.(a) },
    canManage && deletable && { label: 'Delete permanently', icon: Trash2, onClick: () => onDelete?.(a), danger: true },
  ].filter(Boolean)

  const hasBadges = a.isDefault || a.currency !== 'BDT' || archived || inProgress
    || (!a.allowNegative && Number(a.creditLimit) > 0) || (a.isBankingChannel === false && !cash)

  return (
    <Card className={cn('group relative flex flex-col overflow-hidden transition-shadow hover:shadow-sm', archived && 'opacity-70')}>
      <div className="flex flex-1 flex-col gap-4 p-5">
        {/* Identity */}
        <div className="flex items-start gap-3">
          <AccountIcon account={a} />
          <div className="min-w-0 flex-1">
            <Link href={href} className="block truncate text-sm font-semibold text-gray-900 underline-offset-4 hover:underline" title={a.name}>{a.name}</Link>
            <p className="truncate text-xs text-muted-foreground" title={accountSubtitle(a)}>
              {accountSubtitle(a)}{number && <span className="tabular-nums text-gray-400"> · {number}</span>}
            </p>
          </div>
          <div className="-mr-2 -mt-1">
            <ActionMenu items={menu} />
          </div>
        </div>

        {/* Badges */}
        {hasBadges && (
          <div className="-mt-1 flex flex-wrap gap-1">
            {a.isDefault && <Badge variant="warning"><Star className="size-3" /> Default</Badge>}
            {a.currency !== 'BDT' && <Badge variant="outline">{a.currency}</Badge>}
            {archived && <Badge>Archived</Badge>}
            {inProgress && (
              <Link href={`${href}?tab=reconcile`} className="rounded-full">
                <Badge variant="primary" dot>Reconciling</Badge>
              </Link>
            )}
            {!a.allowNegative && Number(a.creditLimit) > 0 && (
              <Badge>OD limit {formatAmount(a.creditLimit, a.currency)}</Badge>
            )}
            {a.isBankingChannel === false && !cash && <Badge>Not a banking channel</Badge>}
          </div>
        )}

        {/* Balance */}
        <div>
          <p className="text-[13px] text-muted-foreground">Balance</p>
          <p className={cn('mt-0.5 text-2xl font-semibold tracking-tight tabular-nums', negative ? 'text-red-600' : 'text-gray-900')}>
            {formatAmount(a.balance, a.currency)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            Cleared {formatAmount(a.clearedBalance, a.currency)}
            {a.unclearedCount > 0 && <span className="text-gray-400"> · {a.unclearedCount} uncleared</span>}
          </p>
          {negative && !a.allowNegative && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600" title="Check for missing receipts">
              <AlertTriangle className="size-3.5" /> Below zero
            </p>
          )}
        </div>

        {/* Meta */}
        <div className="mt-auto space-y-1.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <ShieldCheck className={cn('size-3.5', a.lastReconciledDate ? 'text-emerald-600' : 'text-gray-300')} />
            {a.lastReconciledDate
              ? <>Reconciled to {dayKeyLabel(a.lastReconciledDate)}</>
              : <>{cash ? 'Never counted' : 'Never reconciled'}</>}
          </p>
          <p className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-gray-400" />
            {a.lastTxDate ? <>Last activity {dayKeyLabel(a.lastTxDate)}</> : <>No transactions yet</>}
          </p>
          {cash && a.custodian && (
            <p className="flex items-center gap-1.5"><UserRound className="size-3.5 text-gray-400" /> Held by {a.custodian.name}</p>
          )}
          {a.linkedPaymentMethods?.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {a.linkedPaymentMethods.map(m => (
                <span key={m} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                  {String(m).replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      {!archived && (
        <div className="flex items-stretch gap-1 border-t border-gray-100 p-1.5">
          <QuickAction icon={FileText} label="Statement" href={href} />
          {canManage && <QuickAction icon={ArrowLeftRight} label="Transfer" onClick={() => onTransfer?.(a)} />}
          {canManage && <QuickAction icon={PlusCircle} label="Movement" onClick={() => onMovement?.(a)} />}
          {canReconcile && <QuickAction icon={ListChecks} label={inProgress ? 'Continue' : 'Reconcile'} href={`${href}?tab=reconcile`} />}
        </div>
      )}
    </Card>
  )
}
