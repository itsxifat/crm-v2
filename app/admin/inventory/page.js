'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Package, Wallet, Scale, UserCheck, Boxes, Wrench, BadgeCheck, PackageX, Laptop, ShoppingCart,
  ClipboardCheck, BarChart3, SlidersHorizontal, ShieldCheck, ChevronRight, RefreshCw, FolderInput,
  AlertTriangle, CalendarClock,
} from 'lucide-react'
import StatsCard from '@/components/ui/StatsCard'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import { AssetEventIcon } from '@/components/inventory/AssetStatusBadge'
import { EVENT_META, STATUS_META } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import DepreciationPanel from './reports/_components/DepreciationPanel'
import { fmtTk, fmtMoney, fmtDay, fmtAgo, fetchJson } from './reports/_components/format'

function SectionHeader({ title, subtitle, href, linkLabel = 'View all' }) {
  return (
    <CardHeader className="pb-3">
      <div className="min-w-0">
        <CardTitle as="h2">{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </div>
      {href && (
        <CardAction>
          <Link href={href} className="inline-flex items-center gap-0.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900">
            {linkLabel} <ChevronRight className="size-3.5" />
          </Link>
        </CardAction>
      )}
    </CardHeader>
  )
}

function CategoryTable({ rows }) {
  if (!rows.length) {
    return <ListEmpty>No assets yet</ListEmpty>
  }
  const total = rows.reduce((s, r) => ({
    count: s.count + r.count,
    cost: s.cost + r.capitalizedCost,
    bookValue: s.bookValue + r.bookValue,
  }), { count: 0, cost: 0, bookValue: 0 })
  const max = Math.max(...rows.map(r => r.capitalizedCost), 1)
  return (
    <Table className="border-t border-gray-100">
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">Category</TableHead>
          <TableHead className="text-right">Assets</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Assigned</TableHead>
          <TableHead className="text-right">Capitalised cost</TableHead>
          <TableHead className="pr-5 text-right">Book value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={r.categoryId ?? r.name}>
            <TableCell className="pl-5">
              <Link href={r.categoryId ? `/admin/inventory/assets?categoryId=${r.categoryId}` : '/admin/inventory/assets'} className="font-medium text-gray-900 underline-offset-4 hover:underline">
                {r.name}
              </Link>
              {r.code && <span className="ml-1.5 font-mono text-xs text-gray-400">{r.code}</span>}
              <div className="mt-1.5 h-1 max-w-[220px] overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-gray-900/70" style={{ width: `${Math.max(3, (r.capitalizedCost / max) * 100)}%` }} />
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.count}</TableCell>
            <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{r.assigned}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {r.capitalizedCost > 0 ? fmtMoney(r.capitalizedCost, { decimals: 0 }) : <span className="text-gray-400" title="Below the capitalisation threshold — expensed">Expensed</span>}
            </TableCell>
            <TableCell className="whitespace-nowrap pr-5 text-right tabular-nums">{fmtMoney(r.bookValue, { decimals: 0 })}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow className="hover:bg-transparent">
          <TableCell className="pl-5 font-semibold text-gray-900">Total</TableCell>
          <TableCell className="text-right font-semibold tabular-nums text-gray-900">{total.count}</TableCell>
          <TableCell className="hidden sm:table-cell" />
          <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">{fmtMoney(total.cost, { decimals: 0 })}</TableCell>
          <TableCell className="whitespace-nowrap pr-5 text-right font-semibold tabular-nums text-gray-900">{fmtMoney(total.bookValue, { decimals: 0 })}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}

function ListEmpty({ children }) {
  return <p className="px-5 pb-5 text-sm text-muted-foreground">{children}</p>
}

const QUICK_LINKS = [
  { href: '/admin/inventory/assets', label: 'Assets', icon: Laptop, perm: ['inventory.view', 'inventory.manage'] },
  { href: '/admin/inventory/purchases', label: 'Purchases', icon: ShoppingCart, perm: ['inventory.view', 'inventory.purchase'] },
  { href: '/admin/inventory/stock', label: 'Consumables', icon: Boxes, perm: ['inventory.view', 'inventory.manage'] },
  { href: '/admin/inventory/audits', label: 'Physical audit', icon: ClipboardCheck, perm: ['inventory.audit', 'inventory.manage'] },
  { href: '/admin/inventory/reports', label: 'Reports', icon: BarChart3, perm: ['inventory.view', 'inventory.manage'] },
  { href: '/admin/inventory/settings', label: 'Settings', icon: SlidersHorizontal, perm: ['inventory.manage'] },
]

export default function InventoryDashboardPage() {
  const { can, canAny, ready } = usePermission()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson('/api/inventory/summary')
      setData(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && !data) return <PageLoader />

  if (error && !data) {
    return (
      <Card>
        <EmptyState icon={AlertTriangle} title="Couldn't load inventory" description={error}
          action={<Button onClick={load}>Try again</Button>} />
      </Card>
    )
  }

  const c = data.counts
  const t = data.totals
  const pendingAcks = data.acknowledgements.pending
  const stockAlerts = data.stock.lowStock + data.stock.outOfStock
  const isEmpty = c.total === 0
  const canManage = can('inventory.manage')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        actions={(
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh" title="Refresh">
              <RefreshCw className={cn(loading && 'animate-spin')} />
            </Button>
            {ready && canAny(['inventory.view', 'inventory.manage']) && (
              <Button variant="outline" href="/admin/inventory/reports">
                <BarChart3 /> Reports
              </Button>
            )}
            {ready && canManage && (
              <Button variant={isEmpty ? 'outline' : 'default'} href="/admin/inventory/assets">
                <Package /> Manage assets
              </Button>
            )}
          </>
        )}
      />

      {isEmpty && (
        <Card>
          <EmptyState
            icon={Package}
            title="No assets yet"
            description="Import your opening register or record a purchase."
            action={ready && canManage ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button href="/admin/inventory/settings?tab=opening">
                  <FolderInput /> Import opening register
                </Button>
                <Button variant="outline" href="/admin/inventory/purchases">
                  <ShoppingCart /> Record purchase
                </Button>
              </div>
            ) : null}
          />
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard title="Assets held" value={c.held.toLocaleString('en-BD')} icon={Package} href="/admin/inventory/assets" />
        <StatsCard title="Capitalised cost" value={fmtTk(t.capitalizedCost)} icon={Wallet} href="/admin/inventory/reports?type=register" />
        <StatsCard title="Net book value" value={fmtTk(t.capitalizedBookValue)} icon={Scale} href="/admin/inventory/reports?type=ppe-movement" />
        <StatsCard title="Assigned to staff" value={c.assigned.toLocaleString('en-BD')} icon={UserCheck} href="/admin/inventory/reports?type=custodian" />
        <StatsCard title="In stock (unassigned)" value={c.inStock.toLocaleString('en-BD')} icon={Boxes} href="/admin/inventory/assets?status=IN_STOCK" />
        <StatsCard title="In repair / damaged" value={`${c.inRepair} / ${c.damaged}`} icon={Wrench} color={c.damaged ? 'orange' : c.inRepair ? 'yellow' : 'gray'} href="/admin/inventory/assets?status=IN_REPAIR,DAMAGED" />
        <StatsCard title="Awaiting acknowledgement" value={pendingAcks.toLocaleString('en-BD')} icon={BadgeCheck} color={pendingAcks ? 'yellow' : 'gray'} href="/admin/inventory/assets?ack=PENDING" />
        <StatsCard title="Low / out of stock" value={stockAlerts.toLocaleString('en-BD')} icon={PackageX} color={stockAlerts ? 'red' : 'gray'} href="/admin/inventory/reports?type=low-stock" />
      </div>

      {(c.overdueReturns > 0 || data.damage.recoveriesPending.count > 0 || c.lostOrStolen > 0 || data.acknowledgements.declined > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {c.overdueReturns > 0 && (
            <Alert href="/admin/inventory/reports?type=custodian" tone="amber" text={`${c.overdueReturns} asset${c.overdueReturns === 1 ? '' : 's'} overdue for return`} />
          )}
          {data.damage.recoveriesPending.count > 0 && (
            <Alert href="/admin/inventory/reports?type=damage&recoveryStatus=PENDING" tone="orange"
              text={`${data.damage.recoveriesPending.count} damage recover${data.damage.recoveriesPending.count === 1 ? 'y' : 'ies'} pending (${fmtTk(data.damage.recoveriesPending.amount)})`} />
          )}
          {c.lostOrStolen > 0 && (
            <Alert href="/admin/inventory/assets?status=LOST,STOLEN" tone="red" text={`${c.lostOrStolen} asset${c.lostOrStolen === 1 ? '' : 's'} lost or stolen — review write-off`} />
          )}
          {data.acknowledgements.declined > 0 && (
            <Alert href="/admin/inventory/assets?ack=DECLINED" tone="red" text={`${data.acknowledgements.declined} hand-over${data.acknowledgements.declined === 1 ? '' : 's'} declined`} />
          )}
        </div>
      )}

      {/* Categories + depreciation */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <SectionHeader
            title="By category"
            subtitle={`Threshold ${fmtTk(data.settings.capitalizationThreshold)}${t.expensedCount ? ` · ${t.expensedCount} expensed (${fmtTk(t.expensedCost)})` : ''}`}
            href="/admin/inventory/reports?type=register"
            linkLabel="Register"
          />
          <CategoryTable rows={data.byCategory} />
        </Card>
        <DepreciationPanel canRun={ready && can('inventory.depreciation.run')} onChanged={load} />
      </div>

      {/* Lists */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <SectionHeader
            title="Warranties ending"
            subtitle={`${data.warranties.within30} in 30 days · ${data.warranties.within90} in 90 days${data.warranties.expiredLast30 ? ` · ${data.warranties.expiredLast30} just expired` : ''}`}
            href="/admin/inventory/reports?type=warranty"
          />
          {data.warranties.items.length === 0 ? (
            <ListEmpty>None in the next 90 days</ListEmpty>
          ) : (
            <ul className="divide-y divide-gray-100 border-t border-gray-100 pb-1">
              {data.warranties.items.map(w => (
                <li key={w.id}>
                  <Link href={`/admin/inventory/assets/${w.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50/70">
                    <ShieldCheck className={cn('size-4 shrink-0', w.daysLeft <= 30 ? 'text-amber-500' : 'text-gray-400')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{w.name}</p>
                      <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{w.assetTag}</span>{w.custodian ? ` · ${w.custodian}` : ''}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium text-gray-900">{fmtDay(w.expiry)}</p>
                      <p className={cn('text-xs tabular-nums', w.daysLeft <= 30 ? 'text-amber-600' : 'text-gray-400')}>{w.daysLeft === 0 ? 'today' : `${w.daysLeft} d`}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Awaiting acknowledgement"
            subtitle={pendingAcks ? `${pendingAcks} pending` : null}
            href="/admin/inventory/assets?ack=PENDING"
          />
          {data.acknowledgements.items.length === 0 ? (
            <ListEmpty>All hand-overs acknowledged</ListEmpty>
          ) : (
            <ul className="divide-y divide-gray-100 border-t border-gray-100 pb-1">
              {data.acknowledgements.items.map(a => (
                <li key={a.id}>
                  <Link href={`/admin/inventory/assets/${a.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50/70">
                    <CalendarClock className={cn('size-4 shrink-0', a.daysWaiting > 7 ? 'text-amber-500' : 'text-gray-400')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{a.employee ?? 'Employee'}</p>
                      <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{a.assetTag}</span> · {a.name}</p>
                    </div>
                    <span className={cn('shrink-0 text-xs tabular-nums', a.daysWaiting > 7 ? 'font-medium text-amber-600' : 'text-gray-400')}>
                      {a.daysWaiting == null ? '' : a.daysWaiting === 0 ? 'today' : `${a.daysWaiting} d`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title="Recent activity" />
          {data.recentEvents.length === 0 ? (
            <ListEmpty>No activity yet</ListEmpty>
          ) : (
            <ul className="divide-y divide-gray-100 border-t border-gray-100 pb-1">
              {data.recentEvents.map(e => (
                <li key={e.id}>
                  <Link href={e.assetId ? `/admin/inventory/assets/${e.assetId}` : '#'} className="flex items-start gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50/70">
                    <AssetEventIcon type={e.type} size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {EVENT_META[e.type]?.label ?? e.type}
                        {e.toStatus && e.fromStatus && e.toStatus !== e.fromStatus ? <span className="font-normal text-gray-400"> → {STATUS_META[e.toStatus]?.label ?? e.toStatus}</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{e.assetTag ?? '—'}</span>{e.assetName ? ` · ${e.assetName}` : ''}{e.by ? ` · ${e.by}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">{fmtAgo(e.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Stock + quick links */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle as="h2">Consumable stock</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-[13px] text-muted-foreground">Items</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{data.stock.items}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted-foreground" title="Moving-average cost">Stock value</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{fmtTk(data.stock.value)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted-foreground">At / below reorder</dt>
                <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums', data.stock.lowStock ? 'text-amber-600' : 'text-gray-900')}>{data.stock.lowStock}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted-foreground">Out of stock</dt>
                <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums', data.stock.outOfStock ? 'text-red-600' : 'text-gray-900')}>{data.stock.outOfStock}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" href="/admin/inventory/stock">Open stock</Button>
              <Button variant="outline" size="sm" href="/admin/inventory/reports?type=stock-valuation">Valuation</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle as="h2">Go to</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {QUICK_LINKS.filter(q => ready && canAny(q.perm)).map(q => (
                <Link key={q.href} href={q.href} className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                    <q.icon className="size-4 text-gray-600" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{q.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const ALERT_TONES = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  orange: 'border-orange-200 bg-orange-50 text-orange-800',
  red: 'border-red-200 bg-red-50 text-red-800',
}

function Alert({ href, text, tone = 'amber' }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-opacity hover:opacity-90', ALERT_TONES[tone])}>
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">{text}</span>
      <ChevronRight className="size-4 shrink-0 opacity-60" />
    </Link>
  )
}
