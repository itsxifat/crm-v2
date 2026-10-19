'use client'

import { Wallet, AlertTriangle, ShieldCheck, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCOUNT_GROUPS, FUND_GROUP_COLORS, formatAmount } from './accountTheme'

function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded bg-gray-100', className)} />
}

/**
 * Header totals for the Money Accounts page: total BDT funds with a
 * bank / cash / wallet / other breakdown bar, foreign-currency balances listed
 * separately, and quick health signals.
 */
export default function FundsSummary({ totals, loading }) {
  if (loading && !totals) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5 space-y-4">
          <Skeleton className="h-4 w-32" /><Skeleton className="h-8 w-56" /><Skeleton className="h-3 w-full" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-full" /></div>
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Total BDT funds */}
      <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-500 flex items-center gap-1.5"><Wallet className="w-4 h-4 text-gray-400" /> Total funds (BDT)</p>
            <p className={cn('mt-1 text-3xl font-bold tracking-tight tabular-nums', negativeTotal ? 'text-red-600' : 'text-gray-900')}>
              {formatAmount(bdt.total ?? 0, 'BDT')}
            </p>
            <p className="text-xs text-gray-500 tabular-nums mt-0.5">
              Cleared {formatAmount(bdt.cleared ?? 0, 'BDT')} · {bdt.accountCount ?? 0} BDT account{bdt.accountCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {/* Breakdown bar (positive balances only); legend always carries the labels and values */}
        {barTotal > 0 && (
          <div className="mt-4 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-gray-50" role="img" aria-label="Funds by account type">
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
              <div key={g.key} className="rounded-lg bg-gray-50/70 px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: FUND_GROUP_COLORS[g.key] }} />
                  {g.short}
                </p>
                <p className={cn('text-sm font-semibold tabular-nums', v < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(v, 'BDT')}</p>
                <p className="text-[11px] text-gray-400">{counts[g.key] ?? 0} account{counts[g.key] === 1 ? '' : 's'}{barTotal > 0 && v > 0 ? ` · ${Math.round((v / barTotal) * 100)}%` : ''}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Foreign currency + health */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500">Foreign-currency accounts</p>
          {totals.foreign?.length ? (
            <ul className="mt-2 space-y-2">
              {totals.foreign.map(f => (
                <li key={f.currency}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-gray-700">{f.currency}</span>
                    <span className={cn('text-sm font-semibold tabular-nums', f.total < -0.004 ? 'text-red-600' : 'text-gray-900')}>{formatAmount(f.total, f.currency)}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 truncate">{f.accounts.map(a => a.name).join(', ')} · not included in BDT total</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-gray-400">None. ERQ / FC accounts in USD or other currencies appear here, kept out of the BDT total.</p>
          )}
        </div>
        <div className="mt-auto space-y-1.5 border-t border-gray-50 pt-3 text-xs">
          <p className="flex items-center gap-1.5 text-gray-600">
            <Clock className="w-3.5 h-3.5 text-gray-400" /> {totals.unclearedCount ?? 0} uncleared transaction{totals.unclearedCount === 1 ? '' : 's'}
          </p>
          <p className="flex items-center gap-1.5 text-gray-600">
            <ShieldCheck className={cn('w-3.5 h-3.5', totals.neverReconciled ? 'text-amber-500' : 'text-emerald-600')} />
            {totals.neverReconciled ? `${totals.neverReconciled} account${totals.neverReconciled === 1 ? '' : 's'} never reconciled` : 'All bank & wallet accounts reconciled at least once'}
          </p>
          {totals.negativeCount > 0 && (
            <p className="flex items-center gap-1.5 text-red-600">
              <AlertTriangle className="w-3.5 h-3.5" /> {totals.negativeCount} account{totals.negativeCount === 1 ? '' : 's'} below zero
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
