'use client'

import { AlertTriangle, ShieldCheck, Clock } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { ACCOUNT_GROUPS, FUND_GROUP_COLORS, formatAmount } from './accountTheme'

function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-100', className)} />
}

/**
 * Header totals for the Money Accounts page: total BDT funds with a
 * bank / cash / wallet / other breakdown bar, foreign-currency balances listed
 * separately, and quick health signals.
 */
export default function FundsSummary({ totals, loading }) {
  if (loading && !totals) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="space-y-4 p-5 lg:col-span-2">
          <Skeleton className="h-4 w-32" /><Skeleton className="h-8 w-56" /><Skeleton className="h-2 w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
        </Card>
        <Card className="space-y-3 p-5"><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-full" /></Card>
      </div>
    )
  }
  if (!totals) return null

  const bdt = totals.bdt ?? {}
  const counts = totals.groupCounts ?? {}
  const groups = ACCOUNT_GROUPS.filter(g => g.key !== 'other' || (counts.other ?? 0) > 0)
  const positive = groups.map(g => ({ ...g, value: Math.max(0, Number(bdt[g.key]) || 0) })).filter(g => g.value > 0)
  const barTotal = positive.reduce((s, g) => s + g.value, 0)
  const negativeTotal = bdt.total < -0.004

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Total BDT funds */}
      <Card className="p-5 lg:col-span-2">
        <p className="text-[13px] font-medium text-muted-foreground">Total funds (BDT)</p>
        <p className={cn('mt-1.5 text-3xl font-semibold tracking-tight tabular-nums', negativeTotal ? 'text-red-600' : 'text-gray-900')}>
          {formatAmount(bdt.total ?? 0, 'BDT')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          Cleared {formatAmount(bdt.cleared ?? 0, 'BDT')} · {bdt.accountCount ?? 0} BDT account{bdt.accountCount === 1 ? '' : 's'}
        </p>

        {/* Breakdown bar (positive balances only); legend always carries the labels and values */}
        {barTotal > 0 && (
          <div className="mt-5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-gray-100" role="img" aria-label="Funds by account type">
            {positive.map(g => (
              <div
                key={g.key}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(g.value / barTotal) * 100}%`, backgroundColor: FUND_GROUP_COLORS[g.key] }}
                title={`${g.short}: ${formatAmount(g.value, 'BDT')} (${Math.round((g.value / barTotal) * 100)}%)`}
              />
            ))}
          </div>
        )}

        <div className={cn('mt-4 grid gap-3', groups.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3')}>
          {groups.map(g => {
            const v = Number(bdt[g.key]) || 0
            return (
              <div key={g.key} className="rounded-lg bg-gray-50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: FUND_GROUP_COLORS[g.key] }} />
                  {g.short}
                </p>
                <p className={cn('mt-0.5 text-sm font-semibold tabular-nums', v < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(v, 'BDT')}</p>
                <p className="text-[11px] text-gray-400 tabular-nums">{counts[g.key] ?? 0} account{counts[g.key] === 1 ? '' : 's'}{barTotal > 0 && v > 0 ? ` · ${Math.round((v / barTotal) * 100)}%` : ''}</p>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Foreign currency + health */}
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">Foreign currency</p>
          {totals.foreign?.length ? (
            <ul className="mt-2 space-y-2.5">
              {totals.foreign.map(f => (
                <li key={f.currency}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-gray-700">{f.currency}</span>
                    <span className={cn('text-sm font-semibold tabular-nums', f.total < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(f.total, f.currency)}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={f.accounts.map(a => a.name).join(', ')}>
                    {f.accounts.map(a => a.name).join(', ')} · not in BDT total
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-gray-400" title="ERQ / FC accounts appear here, kept out of the BDT total">None</p>
          )}
        </div>
        <div className="mt-auto space-y-2 border-t border-gray-100 pt-3 text-[13px]">
          <p className="flex items-center gap-2 text-gray-600">
            <Clock className="size-4 text-gray-400" /> {totals.unclearedCount ?? 0} uncleared transaction{totals.unclearedCount === 1 ? '' : 's'}
          </p>
          <p className="flex items-center gap-2 text-gray-600" title={totals.neverReconciled ? undefined : 'Every bank & wallet account reconciled at least once'}>
            <ShieldCheck className={cn('size-4', totals.neverReconciled ? 'text-amber-500' : 'text-emerald-600')} />
            {totals.neverReconciled ? `${totals.neverReconciled} account${totals.neverReconciled === 1 ? '' : 's'} never reconciled` : 'All accounts reconciled'}
          </p>
          {totals.negativeCount > 0 && (
            <p className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="size-4" /> {totals.negativeCount} account{totals.negativeCount === 1 ? '' : 's'} below zero
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
