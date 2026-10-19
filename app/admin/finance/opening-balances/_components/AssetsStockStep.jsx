'use client'

import Link from 'next/link'
import { ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { Can } from '@/components/auth/Can'
import Badge from '@/components/ui/Badge'
import { buttonVariants } from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { plural } from '../_lib/position'
import { Callout, Guidance, Money } from './shared'

function Stat({ label, value, money = true, sub }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-gray-900">
        {money ? <Money value={value} /> : value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

const linkBtn = buttonVariants({ variant: 'outline', size: 'sm' })

export default function AssetsStockStep({ data }) {
  const { assets, stock, receivables, asOfDate } = data
  const asOf = asOfDate ? dayKeyLabel(asOfDate) : 'the day before go-live'

  return (
    <div className="space-y-6">
      {/* Fixed assets */}
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle as="h2">Fixed assets</CardTitle>
          <Can any={['inventory.manage']}>
            <Link href="/admin/inventory/settings?tab=opening" className={linkBtn}>
              Import assets <ArrowUpRight />
            </Link>
          </Can>
        </div>

        <Guidance
          what={`Equipment owned on ${asOf}: original cost, purchase date and depreciation charged up to that day.`}
          where="Your last fixed-asset schedule. Import via Inventory → Settings → Opening import, with each “as of” date set to the day before go-live."
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Opening assets" value={assets.count} money={false} sub={assets.nonCapitalizedCount ? `+${plural(assets.nonCapitalizedCount, 'expensed item')}` : null} />
          <Stat label="Original cost" value={assets.cost} />
          <Stat label="Depreciation to date" value={assets.accumulated} />
          <Stat label="Book value" value={assets.bookValue} />
        </div>

        {assets.asOfMismatchCount > 0 && (
          <Callout tone="warning">
            {plural(assets.asOfMismatchCount, 'opening asset')} {assets.asOfMismatchCount === 1 ? 'has' : 'have'} an “as of” date other than {asOf} — depreciation may start on the wrong day.
          </Callout>
        )}
        {!assets.count && !assets.nonCapitalizedCount && (
          <Callout tone="info">No assets imported yet. Items below the capitalisation threshold are expensed.</Callout>
        )}
      </Card>

      {/* Consumables */}
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle>Consumables on hand</CardTitle>
          <Can any={['inventory.manage', 'inventory.view']}>
            <Link href="/admin/inventory/stock" className={linkBtn}>
              Consumables <ArrowUpRight />
            </Link>
          </Can>
        </div>
        <Guidance
          what="Quantity and unit cost of each item in the store room."
          where={`A count on ${asOf}; unit cost from the last bill. Enter it as an “Opening” stock movement.`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Items" value={stock.items} money={false} />
          <Stat label="Opening lines" value={stock.lines} money={false} />
          <Stat label="Stock value" value={stock.value} />
        </div>
      </Card>

      {/* Receivables */}
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Unpaid client invoices</CardTitle>
            <CardDescription title="Missing one? Create it with its original (pre-go-live) date so it is tracked here.">
              Picked up automatically — nothing to enter
            </CardDescription>
          </div>
          <Can perm="sales.invoices.view">
            <Link href="/admin/invoices" className={linkBtn}>
              Invoices <ArrowUpRight />
            </Link>
          </Can>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Unpaid at go-live" value={receivables.count} money={false} />
          <Stat label="Owed by clients" value={receivables.amount} />
          <Stat label="Collected since go-live" value={receivables.settledSinceGoLive} sub="Already in the ledger" />
        </div>
        {receivables.unconverted?.length > 0 && (
          <Callout tone="warning">
            Excluded (no go-live rate — add it in step 2): {receivables.unconverted.map(u => `${u.currency} ${Number(u.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`).join(', ')}.
          </Callout>
        )}
        {receivables.invoices?.length > 0 && (
          <div>
            <div className="overflow-hidden rounded-lg border border-gray-200/80">
              <Table className="min-w-[520px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Dated</TableHead>
                    <TableHead className="text-right">Due at go-live</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivables.invoices.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell className="py-2.5">
                        <Link href={`/admin/invoices/${inv.id}`} className="font-medium text-gray-900 underline-offset-4 hover:underline">{inv.invoiceNumber || 'Invoice'}</Link>
                        {inv.status === 'PAID' && <Badge variant="success" className="ml-2">Paid since</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate py-2.5">{inv.clientName || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 text-muted-foreground">{inv.issueDate ? dayKeyLabel(inv.issueDate) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 text-right">
                        <Money value={inv.dueAtGoLive} currency={inv.currency} className="tabular-nums text-gray-900" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {receivables.count > receivables.invoices.length && (
              <p className="mt-2 text-xs text-muted-foreground">Showing the {receivables.invoices.length} largest of {receivables.count}.</p>
            )}
          </div>
        )}
        {!receivables.count && data.goLiveDate && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5 text-emerald-600" /> No invoices were unpaid at go-live.</p>
        )}
      </Card>
    </div>
  )
}
