'use client'

import { dayKeyLabel } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { TAX_ASSET_BUCKETS, TAX_LIABILITY_BUCKETS, TAX_BUCKET_LABELS } from '../_lib/position'
import { Money, cardCls } from './shared'

function Row({ label, value, sub, bold, muted, indent }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', indent && 'pl-3')}>
      <span className={cn('text-sm min-w-0', bold ? 'font-semibold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-700')}>
        {label}
        {sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}
      </span>
      <Money value={value} className={cn('text-sm tabular-nums whitespace-nowrap', bold ? 'font-semibold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-800')} />
    </div>
  )
}

/**
 * Opening position statement: what the business owned and owed at the end of
 * the day before go-live, and the balancing opening equity.
 * `detailed` adds the tax breakdown (review step); the compact form sits beside the wizard.
 */
export default function PositionCard({ position, tax, asOfDate, dirty = false, detailed = false, className }) {
  if (!position) return null
  const { assets, liabilities, equity, unconverted } = position
  const money = [
    ['Cash in hand', assets.cash],
    ['Bank balances', assets.bank],
    ['Mobile wallets', assets.mfs],
    ['Other money accounts', assets.otherMoney],
  ].filter(([, v]) => detailed || Math.abs(v) >= 0.005)

  return (
    <div className={cn(cardCls, 'p-5', className)}>
      <div className="mb-3 min-w-0">
        <h2 className="text-sm font-semibold text-gray-900">Opening position</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {asOfDate ? `As at end of ${dayKeyLabel(asOfDate)}` : 'Set the go-live date first'}
          {dirty && <span className="ml-1 font-medium text-amber-700">· unsaved changes</span>}
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        <div className="pb-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Assets</p>
          {money.map(([label, v]) => <Row key={label} label={label} value={v} indent />)}
          {(detailed || assets.receivables > 0) && <Row label="Unpaid client invoices" value={assets.receivables} indent />}
          {(detailed || assets.taxAssets > 0) && <Row label="Tax credits & refunds due" value={assets.taxAssets} indent />}
          {detailed && tax && TAX_ASSET_BUCKETS.filter(b => tax.totals[b] > 0).map(b => (
            <Row key={b} label={TAX_BUCKET_LABELS[b]} value={tax.totals[b]} muted indent />
          ))}
          {(detailed || assets.fixedAssets > 0) && <Row label="Fixed assets (book value)" value={assets.fixedAssets} indent />}
          {(detailed || assets.stock > 0) && <Row label="Consumables in stock" value={assets.stock} indent />}
          <Row label="Total assets" value={assets.total} bold />
        </div>

        <div className="py-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Liabilities</p>
          {(detailed || liabilities.taxPayable > 0) && <Row label="Tax payable" value={liabilities.taxPayable} indent />}
          {detailed && tax && TAX_LIABILITY_BUCKETS.filter(b => tax.totals[b] > 0).map(b => (
            <Row key={b} label={TAX_BUCKET_LABELS[b]} value={tax.totals[b]} muted indent />
          ))}
          {(detailed || liabilities.overdrafts > 0) && <Row label="Overdrafts, loans & card balances" value={liabilities.overdrafts} indent />}
          <Row label="Total liabilities" value={liabilities.total} bold />
        </div>

        <div className="pt-2">
          <div className={cn('mt-1 rounded-lg px-3 py-2.5', equity < -0.005 ? 'bg-red-50' : 'bg-gray-50')}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="cursor-help text-sm font-semibold text-gray-900 underline decoration-dotted decoration-gray-300 underline-offset-4"
                title="Assets − liabilities: owners' capital plus profit kept in the business up to go-live."
              >
                Opening balance equity
              </span>
              <Money value={equity} className={cn('whitespace-nowrap text-base font-semibold tabular-nums', equity < -0.005 ? 'text-red-700' : 'text-gray-900')} />
            </div>
          </div>
        </div>
      </div>

      {unconverted?.length > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          Excluded (no exchange rate): {unconverted.map(u => `${u.currency} ${Number(u.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(', ')}
        </p>
      )}
    </div>
  )
}
