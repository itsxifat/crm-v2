'use client'

import { CheckCircle2, AlertTriangle, AlertOctagon, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { tk } from './taxUi'

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10

/**
 * Cash share of this income year's payments vs the s.55 threshold, with the
 * estimated disallowance and the cashless corporate-rate condition.
 *
 * Props: data (cashPaymentRatio result), corporateRate, cashlessRate, loading
 */
export default function CashlessMeter({ data, corporateRate = 27.5, cashlessRate = 25, loading = false }) {
  if (loading) {
    return (
      <Card className="space-y-3 p-5">
        <div className="h-4 w-48 animate-pulse rounded-md bg-gray-100" />
        <div className="h-3 w-full animate-pulse rounded-md bg-gray-100" />
        <div className="h-3 w-2/3 animate-pulse rounded-md bg-gray-100" />
      </Card>
    )
  }
  if (!data) {
    return (
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-900">Cash payments (s.55)</h2>
        <p className="mt-2 text-sm text-muted-foreground">Couldn&apos;t compute the cash-payment ratio.</p>
      </Card>
    )
  }

  const ratio = Math.max(0, Math.min(100, Number(data.ratioPct) || 0))
  const threshold = Math.max(0, Math.min(100, Number(data.thresholdPct) || 50))
  const status = data.overThreshold ? 'critical' : ratio >= threshold * 0.6 ? 'warning' : 'good'
  const STATUS = {
    good:     { fill: 'bg-emerald-500', text: 'text-emerald-700', Icon: CheckCircle2, label: 'Within limit' },
    warning:  { fill: 'bg-amber-500',   text: 'text-amber-700',   Icon: AlertTriangle, label: 'Near limit' },
    critical: { fill: 'bg-red-500',     text: 'text-red-700',     Icon: AlertOctagon, label: 'Over limit' },
  }[status]
  const noPayments = !(data.totalBDT > 0)

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Cash payments (s.55) · FY {data.fiscalYear}</h2>
          <p
            className="mt-0.5 text-[13px] text-muted-foreground"
            title={`If more than ${threshold}% of payments are not through a bank, ${data.disallowPct}% of the cash payments is disallowed.`}
          >
            Over {threshold}% cash: {data.disallowPct}% disallowed
          </p>
        </div>
        {!noPayments && (
          <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium', STATUS.text)}>
            <STATUS.Icon className="size-3.5" /> {STATUS.label}
          </span>
        )}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{noPayments ? '—' : `${round1(ratio)}%`}</p>
          <p className="text-xs text-muted-foreground">of {tk(data.totalBDT)} paid in cash</p>
        </div>
        <div
          className="relative mt-2 h-2 rounded-full bg-gray-100"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={round1(ratio)}
          aria-label={`Cash share of payments ${round1(ratio)}%, limit ${threshold}%`}
        >
          <div className={cn('absolute inset-y-0 left-0 rounded-full', STATUS.fill)} style={{ width: `${noPayments ? 0 : Math.max(ratio, ratio > 0 ? 1.5 : 0)}%` }} />
          <div className="absolute -bottom-1 -top-1 w-0.5 rounded-full bg-gray-900" style={{ left: `calc(${threshold}% - 1px)` }} />
        </div>
        <div className="relative mt-1.5 h-4 text-[11px] text-muted-foreground tabular-nums">
          <span className="absolute left-0">0%</span>
          <span className="absolute -translate-x-1/2 font-medium text-gray-700" style={{ left: `${threshold}%` }}>{threshold}% limit</span>
          <span className="absolute right-0">100%</span>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Cash payments</dt>
          <dd className="mt-0.5 font-medium text-gray-900 tabular-nums">{tk(data.cashBDT)} <span className="font-normal text-gray-400">· {data.cashPaymentCount} of {data.paymentCount}</span></dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Est. disallowance</dt>
          <dd className={cn('mt-0.5 font-medium tabular-nums', data.disallowEstimateBDT > 0 ? 'text-red-700' : 'text-gray-900')}>{tk(data.disallowEstimateBDT)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cash salary / rent</dt>
          <dd className={cn('mt-0.5 font-medium tabular-nums', data.cashSalaryRentBDT > 0 ? 'text-amber-700' : 'text-gray-900')}>{tk(data.cashSalaryRentBDT)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Income received in cash</dt>
          <dd className="mt-0.5 font-medium text-gray-900 tabular-nums">{tk(data.incomeCashBDT)}</dd>
        </div>
      </dl>

      <div className={cn(
        'mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]',
        data.cashlessEligible ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200/80 bg-gray-50 text-gray-700'
      )}>
        {data.cashlessEligible ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0 text-gray-500" />}
        <span>
          {data.cashlessEligible
            ? `All banked so far — on track for the ${cashlessRate}% cashless rate (vs ${corporateRate}%).`
            : `Cash used this year — the ${cashlessRate}% cashless rate is at risk (${corporateRate}% otherwise).`}
          {data.cashSalaryRentBDT > 0 && ' Cash salary and rent aren’t deductible.'}
        </span>
      </div>
    </Card>
  )
}
