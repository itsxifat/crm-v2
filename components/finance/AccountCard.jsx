'use client'

import Link from 'next/link'
import {
  ArrowLeftRight, PlusCircle, ListChecks, FileText, Pencil, Archive, ArchiveRestore, Trash2, Star,
  ShieldCheck, Clock, UserRound, AlertTriangle,
} from 'lucide-react'
import ActionMenu from '@/components/ui/ActionMenu'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import AccountIcon from './AccountIcon'
import { accountColor, accountSubtitle, maskedNumber, formatAmount, withAlpha } from './accountTheme'

function QuickAction({ icon: Icon, label, onClick, href }) {
  const cls = 'flex-1 min-w-0 inline-flex flex-col sm:flex-row items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors'
  if (href) return <Link href={href} className={cls}><Icon className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{label}</span></Link>
  return <button type="button" onClick={onClick} className={cls}><Icon className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{label}</span></button>
}

/**
 * One money account as a card: identity, balance, cleared balance, reconciliation status, quick actions.
 */
export default function AccountCard({
  account, canManage, canReconcile, onTransfer, onMovement, onEdit, onArchive, onRestore, onDelete,
}) {
  const a = account
  const color = accountColor(a)
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

  return (
    <div className={cn(
      'group relative bg-white border border-gray-100 rounded-xl overflow-hidden flex flex-col transition-shadow hover:shadow-sm',
      archived && 'opacity-70',
    )}>
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="p-4 flex-1 flex flex-col gap-3">
        {/* Identity */}
        <div className="flex items-start gap-3">
          <AccountIcon account={a} />
          <div className="min-w-0 flex-1">
            <Link href={href} className="block text-sm font-semibold text-gray-900 hover:underline truncate" title={a.name}>{a.name}</Link>
            <p className="text-xs text-gray-500 truncate" title={accountSubtitle(a)}>{accountSubtitle(a)}</p>
            {number && <p className="text-xs text-gray-400 tabular-nums mt-0.5">{number}</p>}
          </div>
          <ActionMenu items={menu} />
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1">
          {a.isDefault && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"><Star className="w-3 h-3" /> Default</span>
          )}
          {a.currency !== 'BDT' && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{a.currency}</span>
          )}
          {archived && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Archived</span>}
          {inProgress && (
            <Link href={`${href}?tab=reconcile`} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-100">Reconciling…</Link>
          )}
          {!a.allowNegative && Number(a.creditLimit) > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">OD limit {formatAmount(a.creditLimit, a.currency)}</span>
          )}
          {a.isBankingChannel === false && !cash && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">Not a banking channel</span>
          )}
        </div>

        {/* Balance */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Balance</p>
          <p className={cn('text-xl font-bold tabular-nums tracking-tight', negative ? 'text-red-600' : 'text-gray-900')}>
            {formatAmount(a.balance, a.currency)}
          </p>
          <p className="text-xs text-gray-500 tabular-nums">
            Cleared {formatAmount(a.clearedBalance, a.currency)}
            {a.unclearedCount > 0 && <span className="text-gray-400"> · {a.unclearedCount} uncleared</span>}
          </p>
          {negative && !a.allowNegative && (
            <p className="mt-1 text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Below zero — check for missing receipts</p>
          )}
        </div>

        {/* Meta */}
        <div className="space-y-1 text-[11px] text-gray-500">
          <p className="flex items-center gap-1.5">
            <ShieldCheck className={cn('w-3.5 h-3.5', a.lastReconciledDate ? 'text-emerald-600' : 'text-gray-300')} />
            {a.lastReconciledDate
              ? <>Reconciled to {dayKeyLabel(a.lastReconciledDate)}</>
              : <>{cash ? 'Never counted' : 'Never reconciled'}</>}
          </p>
          <p className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-gray-300" />
            {a.lastTxDate ? <>Last activity {dayKeyLabel(a.lastTxDate)}</> : <>No transactions yet</>}
          </p>
          {cash && a.custodian && (
            <p className="flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5 text-gray-300" /> Held by {a.custodian.name}</p>
          )}
          {a.linkedPaymentMethods?.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {a.linkedPaymentMethods.map(m => (
                <span key={m} className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: withAlpha(color, 0.08), color }}>
                  {String(m).replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      {!archived && (
        <div className="border-t border-gray-50 px-2 py-1.5 flex items-stretch gap-1">
          <QuickAction icon={FileText} label="Statement" href={href} />
          {canManage && <QuickAction icon={ArrowLeftRight} label="Transfer" onClick={() => onTransfer?.(a)} />}
          {canManage && <QuickAction icon={PlusCircle} label="Movement" onClick={() => onMovement?.(a)} />}
          {canReconcile && <QuickAction icon={ListChecks} label={inProgress ? 'Continue' : 'Reconcile'} href={`${href}?tab=reconcile`} />}
        </div>
      )}
    </div>
  )
}
