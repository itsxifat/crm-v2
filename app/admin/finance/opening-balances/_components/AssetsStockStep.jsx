'use client'

import Link from 'next/link'
import { ArrowUpRight, Boxes, CheckCircle2, FileText, Laptop } from 'lucide-react'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { Can } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { plural } from '../_lib/position'
import { Callout, Guidance, Money, btnGhost, cardCls } from './shared'

function Stat({ label, value, money = true, sub }) {
  return (
    <div className="rounded-lg border border-gray-100 px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 tabular-nums truncate">
        {money ? <Money value={value} /> : value}
      </p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}

export default function AssetsStockStep({ data }) {
  const { assets, stock, receivables, asOfDate } = data
  const asOf = asOfDate ? dayKeyLabel(asOfDate) : 'the day before go-live'

  return (
    <div className="space-y-6">
      {/* Fixed assets */}
      <div className={`${cardCls} p-4 sm:p-6 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
              <Laptop className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Step 4 — Fixed assets & stock</h2>
              <p className="text-sm text-gray-500">Equipment and supplies you already owned at go-live.</p>
            </div>
          </div>
          <Can any={['inventory.manage']}>
            <Link href="/admin/inventory/settings?tab=opening" className={cn(btnGhost, 'shrink-0')}>
              Import existing assets <ArrowUpRight className="w-4 h-4" />
            </Link>
          </Can>
        </div>

        <Guidance
          what={`Laptops, monitors, furniture, ACs and other equipment owned on ${asOf}: original cost, purchase date and the depreciation already charged up to that day.`}
          where="Your last audited fixed-asset schedule (or purchase bills for newer items). Import them in Inventory → Settings → Opening import; set each asset's “as of” date to the day before go-live so monthly depreciation starts at go-live."
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Opening assets" value={assets.count} money={false} sub={assets.nonCapitalizedCount ? `+${plural(assets.nonCapitalizedCount, 'expensed item')}` : null} />
          <Stat label="Original cost" value={assets.cost} />
          <Stat label="Depreciation to date" value={assets.accumulated} />
          <Stat label="Book value" value={assets.bookValue} />
        </div>

        {assets.asOfMismatchCount > 0 && (
          <Callout tone="warning">
            {plural(assets.asOfMismatchCount, 'opening asset')} {assets.asOfMismatchCount === 1 ? 'has' : 'have'} an “as of” date other than {asOf}. Their depreciation may start on the wrong day — fix them on the asset page.
          </Callout>
        )}
        {!assets.count && !assets.nonCapitalizedCount && (
          <Callout tone="info">No existing assets imported yet. Items below the capitalisation threshold are expensed and do not appear in the position.</Callout>
        )}
      </div>

      {/* Consumables */}
      <div className={`${cardCls} p-4 sm:p-6 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Consumables on hand</h3>
              <p className="text-sm text-gray-500">Stationery, toner, pantry and cleaning supplies.</p>
            </div>
          </div>
          <Can any={['inventory.manage', 'inventory.view']}>
            <Link href="/admin/inventory/stock" className={cn(btnGhost, 'shrink-0')}>
              Open consumables <ArrowUpRight className="w-4 h-4" />
            </Link>
          </Can>
        </div>
        <Guidance
          what="Quantity and unit cost of each item in the store room."
          where={`A physical count on ${asOf}; unit cost from the last purchase bill. Enter it as an “Opening” stock movement (or in the opening import).`}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Items with opening stock" value={stock.items} money={false} />
          <Stat label="Opening lines" value={stock.lines} money={false} />
          <Stat label="Stock value" value={stock.value} />
        </div>
      </div>

      {/* Receivables */}
      <div className={`${cardCls} p-4 sm:p-6 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Client invoices unpaid at go-live</h3>
              <p className="text-sm text-gray-500">Picked up automatically from invoices dated before go-live — nothing to enter.</p>
            </div>
          </div>
          <Can perm="sales.invoices.view">
            <Link href="/admin/invoices" className={cn(btnGhost, 'shrink-0')}>
              Invoices <ArrowUpRight className="w-4 h-4" />
            </Link>
          </Can>
        </div>
        <Guidance
          what="Nothing — the CRM already has these invoices."
          where="If a client owed you money on an invoice that is not in the CRM, create that invoice with its original date (before go-live) so it is collected and tracked here."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat label="Invoices unpaid at go-live" value={receivables.count} money={false} />
          <Stat label="Owed by clients at go-live" value={receivables.amount} />
          <Stat label="Collected since go-live" value={receivables.settledSinceGoLive} sub="Already reflected in the ledger" />
        </div>
        {receivables.unconverted?.length > 0 && (
          <Callout tone="warning">
            Foreign-currency invoices without a go-live rate are left out: {receivables.unconverted.map(u => `${u.currency} ${Number(u.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`).join(', ')}. Add the rate in step 2.
          </Callout>
        )}
        {receivables.invoices?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-2 font-semibold">Invoice</th>
                  <th className="py-2 px-2 font-semibold">Client</th>
                  <th className="py-2 px-2 font-semibold">Dated</th>
                  <th className="py-2 pl-2 font-semibold text-right">Due at go-live</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {receivables.invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="py-2 pr-2">
                      <Link href={`/admin/invoices/${inv.id}`} className="text-gray-900 hover:underline font-medium">{inv.invoiceNumber || 'Invoice'}</Link>
                      {inv.status === 'PAID' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">Paid since</span>}
                    </td>
                    <td className="py-2 px-2 text-gray-600 truncate max-w-[180px]">{inv.clientName || '—'}</td>
                    <td className="py-2 px-2 text-gray-500 whitespace-nowrap">{inv.issueDate ? dayKeyLabel(inv.issueDate) : '—'}</td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      <Money value={inv.dueAtGoLive} currency={inv.currency} className="tabular-nums" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {receivables.count > receivables.invoices.length && (
              <p className="text-xs text-gray-400 mt-2">Showing the {receivables.invoices.length} largest of {receivables.count}.</p>
            )}
          </div>
        )}
        {!receivables.count && data.goLiveDate && (
          <p className="text-xs text-gray-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> No invoices were unpaid at go-live.</p>
        )}
      </div>
    </div>
  )
}
