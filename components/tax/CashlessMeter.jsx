'use client'

import { Banknote, CheckCircle2, AlertTriangle, AlertOctagon, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
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
      <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5 space-y-3">
        <div className="h-4 w-48 rounded bg-gray-100 animate-pulse" />
        <div className="h-3 w-full rounded bg-gray-100 animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-gray-100 animate-pulse" />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-900">Cash payments rule</h2>
        <p className="mt-2 text-sm text-gray-500">The cash-payment ratio could not be computed.</p>
      </div>
    )
  }

  const ratio = Math.max(0, Math.min(100, Number(data.ratioPct) || 0))
  const threshold = Math.max(0, Math.min(100, Number(data.thresholdPct) || 50))
  const status = data.overThreshold ? 'critical' : ratio >= threshold * 0.6 ? 'warning' : 'good'
  const STATUS = {
    good:     { fill: 'bg-emerald-500', text: 'text-emerald-700', Icon: CheckCircle2, label: 'Within the limit' },
    warning:  { fill: 'bg-amber-500',   text: 'text-amber-700',   Icon: AlertTriangle, label: 'Close to the limit' },
    critical: { fill: 'bg-red-500',     text: 'text-red-700',     Icon: AlertOctagon, label: 'Over the limit' },
  }[status]
  const noPayments = !(data.totalBDT > 0)

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Cash payments rule (s.55) — FY {data.fiscalYear}</h2>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">If more than {threshold}% of payments are not through a bank, {data.disallowPct}% of the cash payments is disallowed.</p>
        </div>
        {!noPayments && (
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap', STATUS.text)}>
            <STATUS.Icon className="w-3.5 h-3.5" /> {STATUS.label}
          </span>
        )}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold text-gray-900">{noPayments ? '—' : `${round1(ratio)}%`}</p>
          <p className="text-xs text-gray-500">of {tk(data.totalBDT)} paid in cash</p>
        </div>
        <div
          className="relative mt-2 h-3 rounded-full bg-gray-100"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={round1(ratio)}
          aria-label={`Cash share of payments ${round1(ratio)}%, limit ${threshold}%`}
        >
          <div className={cn('absolute inset-y-0 left-0 rounded-full', STATUS.fill)} style={{ width: `${noPayments ? 0 : Math.max(ratio, ratio > 0 ? 1.5 : 0)}%` }} />
          <div className="absolute -top-1 -bottom-1 w-0.5 bg-gray-700" style={{ left: `calc(${threshold}% - 1px)` }} />
        </div>
        <div className="relative mt-1 h-4 text-[10px] text-gray-500">
          <span className="absolute left-0">0%</span>
          <span className="absolute -translate-x-1/2 font-medium text-gray-700" style={{ left: `${threshold}%` }}>{threshold}% limit</span>
          <span className="absolute right-0">100%</span>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-gray-500">Cash payments</dt>
          <dd className="font-medium text-gray-900">{tk(data.cashBDT)} <span className="font-normal text-gray-400">· {data.cashPaymentCount} of {data.paymentCount}</span></dd>
        </div>
        <div>
          <dt className="text-gray-500">Estimated disallowance</dt>
          <dd className={cn('font-medium', data.disallowEstimateBDT > 0 ? 'text-red-700' : 'text-gray-900')}>{tk(data.disallowEstimateBDT)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Cash salary / rent</dt>
          <dd className={cn('font-medium', data.cashSalaryRentBDT > 0 ? 'text-amber-700' : 'text-gray-900')}>{tk(data.cashSalaryRentBDT)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Income received in cash</dt>
          <dd className="font-medium text-gray-900">{tk(data.incomeCashBDT)}</dd>
        </div>
      </dl>

      <div className={cn('mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs', data.cashlessEligible ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-600')}>
        {data.cashlessEligible ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
        <span>
          {data.cashlessEligible
            ? `All receipts and payments so far went through banking channels — on track for the ${cashlessRate}% corporate rate (instead of ${corporateRate}%).`
            : `Cash was used this year, so the reduced ${cashlessRate}% corporate rate (all transactions through banks) is at risk — ${corporateRate}% applies otherwise.`}
          {data.cashSalaryRentBDT > 0 && ' Salary and rent paid in cash are not deductible.'}
        </span>
      </div>
    </div>
  )
}
