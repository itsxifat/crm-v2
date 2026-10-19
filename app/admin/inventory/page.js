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
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import { AssetEventIcon } from '@/components/inventory/AssetStatusBadge'
import { EVENT_META, STATUS_META } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import DepreciationPanel from './reports/_components/DepreciationPanel'
import { fmtTk, fmtMoney, fmtDay, fmtAgo, fetchJson } from './reports/_components/format'

const card = 'bg-white border border-gray-100 rounded-xl'

function SectionHeader({ title, subtitle, href, linkLabel = 'View all' }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="text-xs font-medium text-gray-500 hover:text-gray-900 inline-flex items-center gap-0.5 shrink-0">
          {linkLabel} <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  )
}

function CategoryTable({ rows }) {
  if (!rows.length) {
    return <p className="px-5 pb-5 text-sm text-gray-500">No assets on the register yet.</p>
  }
  const total = rows.reduce((s, r) => ({
    count: s.count + r.count,
    cost: s.cost + r.capitalizedCost,
    bookValue: s.bookValue + r.bookValue,
  }), { count: 0, cost: 0, bookValue: 0 })
  const max = Math.max(...rows.map(r => r.capitalizedCost), 1)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <th className="px-5 py-2.5">Category</th>
            <th className="px-3 py-2.5 text-right">Assets</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">Assigned</th>
            <th className="px-3 py-2.5 text-right">Cost (capitalised)</th>
            <th className="px-5 py-2.5 text-right">Book value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(r => (
            <tr key={r.categoryId ?? r.name} className="hover:bg-gray-50/60">
              <td className="px-5 py-2.5">
                <Link href={r.categoryId ? `/admin/inventory/assets?categoryId=${r.categoryId}` : '/admin/inventory/assets'} className="font-medium text-gray-900 hover:underline">
                  {r.name}
                </Link>
                {r.code && <span className="ml-1.5 text-xs text-gray-400 font-mono">{r.code}</span>}
                <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden max-w-[220px]">
                  <div className="h-full bg-gray-900/70 rounded-full" style={{ width: `${Math.max(3, (r.capitalizedCost / max) * 100)}%` }} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.count}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-500 hidden sm:table-cell">{r.assigned}</td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                {r.capitalizedCost > 0 ? fmtMoney(r.capitalizedCost, { decimals: 0 }) : <span className="text-gray-400" title="Below the capitalisation threshold — expensed">Expensed</span>}
              </td>
              <td className="px-5 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtMoney(r.bookValue, { decimals: 0 })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-100 font-semibold text-gray-900">
            <td className="px-5 py-2.5">Total</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{total.count}</td>
            <td className="px-3 py-2.5 hidden sm:table-cell" />
            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtMoney(total.cost, { decimals: 0 })}</td>
            <td className="px-5 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtMoney(total.bookValue, { decimals: 0 })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function ListEmpty({ children }) {
  return <p className="px-5 pb-5 text-sm text-gray-500">{children}</p>
}

const QUICK_LINKS = [
  { href: '/admin/inventory/assets', label: 'Assets', icon: Laptop, perm: ['inventory.view', 'inventory.manage'], hint: 'Register, assign, repair, dispose' },
  { href: '/admin/inventory/purchases', label: 'Purchases', icon: ShoppingCart, perm: ['inventory.view', 'inventory.purchase'], hint: 'Bills with VAT, VDS & TDS' },
  { href: '/admin/inventory/stock', label: 'Consumables', icon: Boxes, perm: ['inventory.view', 'inventory.manage'], hint: 'Stock, issues & reorder' },
  { href: '/admin/inventory/audits', label: 'Physical audit', icon: ClipboardCheck, perm: ['inventory.audit', 'inventory.manage'], hint: 'Count and verify assets' },
  { href: '/admin/inventory/reports', label: 'Reports', icon: BarChart3, perm: ['inventory.view', 'inventory.manage'], hint: 'Register, depreciation, tax schedule' },
  { href: '/admin/inventory/settings', label: 'Settings', icon: SlidersHorizontal, perm: ['inventory.manage'], hint: 'Categories, locations, policy, import' },
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
      <div className={cn(card, 'p-6')}>
        <EmptyState icon={AlertTriangle} title="Couldn't load the inventory overview" description={error}
          action={<button onClick={load} className="bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">Try again</button>} />
      </div>
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventory &amp; assets</h1>
          <p className="text-sm text-gray-500">Office equipment, its custody and value, and consumable stock.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
          </button>
          {ready && canAny(['inventory.view', 'inventory.manage']) && (
            <Link href="/admin/inventory/reports" className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium">
              <BarChart3 className="w-4 h-4" /> Reports
            </Link>
          )}
          {ready && canManage && (
            <Link href="/admin/inventory/assets" className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">
              <Package className="w-4 h-4" /> Manage assets
            </Link>
          )}
        </div>
      </div>

      {isEmpty && (
        <div className={cn(card, 'p-6')}>
          <EmptyState
            icon={Package}
            title="Your asset register is empty"
            description="Bring in the equipment you already own as an opening register, then record new purchases with purchase bills so VAT, VDS and TDS are handled."
            action={ready && canManage ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/admin/inventory/settings?tab=opening" className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">
                  <FolderInput className="w-4 h-4" /> Import opening register
                </Link>
                <Link href="/admin/inventory/purchases" className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium">
                  <ShoppingCart className="w-4 h-4" /> Record a purchase
                </Link>
              </div>
            ) : null}
          />
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard title="Assets held" value={c.held.toLocaleString('en-BD')} icon={Package} color="blue" href="/admin/inventory/assets" />
        <StatsCard title="Cost (capitalised)" value={fmtTk(t.capitalizedCost)} icon={Wallet} color="indigo" href="/admin/inventory/reports?type=register" />
        <StatsCard title="Net book value" value={fmtTk(t.capitalizedBookValue)} icon={Scale} color="purple" href="/admin/inventory/reports?type=ppe-movement" />
        <StatsCard title="Assigned to staff" value={c.assigned.toLocaleString('en-BD')} icon={UserCheck} color="green" href="/admin/inventory/reports?type=custodian" />
        <StatsCard title="In stock (unassigned)" value={c.inStock.toLocaleString('en-BD')} icon={Boxes} color="teal" href="/admin/inventory/assets?status=IN_STOCK" />
        <StatsCard title="In repair / damaged" value={`${c.inRepair} / ${c.damaged}`} icon={Wrench} color={c.damaged ? 'orange' : 'yellow'} href="/admin/inventory/assets?status=IN_REPAIR,DAMAGED" />
        <StatsCard title="Awaiting acknowledgement" value={pendingAcks.toLocaleString('en-BD')} icon={BadgeCheck} color={pendingAcks ? 'yellow' : 'emerald'} href="/admin/inventory/assets?ack=PENDING" />
        <StatsCard title="Low / out of stock" value={stockAlerts.toLocaleString('en-BD')} icon={PackageX} color={stockAlerts ? 'red' : 'emerald'} href="/admin/inventory/reports?type=low-stock" />
      </div>

      {(c.overdueReturns > 0 || data.damage.recoveriesPending.count > 0 || c.lostOrStolen > 0 || data.acknowledgements.declined > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {c.overdueReturns > 0 && (
            <Alert href="/admin/inventory/reports?type=custodian" tone="amber" text={`${c.overdueReturns} asset${c.overdueReturns === 1 ? '' : 's'} past the expected return date`} />
          )}
          {data.damage.recoveriesPending.count > 0 && (
            <Alert href="/admin/inventory/reports?type=damage&recoveryStatus=PENDING" tone="orange"
              text={`${data.damage.recoveriesPending.count} damage recover${data.damage.recoveriesPending.count === 1 ? 'y' : 'ies'} pending (${fmtTk(data.damage.recoveriesPending.amount)})`} />
          )}
          {c.lostOrStolen > 0 && (
            <Alert href="/admin/inventory/assets?status=LOST,STOLEN" tone="red" text={`${c.lostOrStolen} asset${c.lostOrStolen === 1 ? '' : 's'} lost or stolen — decide on write-off`} />
          )}
          {data.acknowledgements.declined > 0 && (
            <Alert href="/admin/inventory/assets?ack=DECLINED" tone="red" text={`${data.acknowledgements.declined} hand-over${data.acknowledgements.declined === 1 ? '' : 's'} declined by the employee`} />
          )}
        </div>
      )}

      {/* Categories + depreciation */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className={cn(card, 'lg:col-span-2 overflow-hidden')}>
          <SectionHeader
            title="By category"
            subtitle={`Assets held · capitalisation threshold ${fmtTk(data.settings.capitalizationThreshold)}${t.expensedCount ? ` · ${t.expensedCount} expensed item${t.expensedCount === 1 ? '' : 's'} (${fmtTk(t.expensedCost)}) tracked for custody` : ''}`}
            href="/admin/inventory/reports?type=register"
            linkLabel="Register"
          />
          <CategoryTable rows={data.byCategory} />
        </div>
        <DepreciationPanel canRun={ready && can('inventory.depreciation.run')} onChanged={load} />
      </div>

      {/* Lists */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className={card}>
          <SectionHeader
            title="Warranties ending"
            subtitle={`${data.warranties.within30} in 30 days · ${data.warranties.within90} in 90 days${data.warranties.expiredLast30 ? ` · ${data.warranties.expiredLast30} just expired` : ''}`}
            href="/admin/inventory/reports?type=warranty"
          />
          {data.warranties.items.length === 0 ? (
            <ListEmpty>No warranties end in the next 90 days.</ListEmpty>
          ) : (
            <ul className="divide-y divide-gray-50 pb-2">
              {data.warranties.items.map(w => (
                <li key={w.id}>
                  <Link href={`/admin/inventory/assets/${w.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50/60">
                    <ShieldCheck className={cn('w-4 h-4 shrink-0', w.daysLeft <= 30 ? 'text-amber-500' : 'text-gray-400')} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 truncate">{w.name}</p>
                      <p className="text-xs text-gray-500 truncate"><span className="font-mono">{w.assetTag}</span>{w.custodian ? ` · ${w.custodian}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-gray-900">{fmtDay(w.expiry)}</p>
                      <p className={cn('text-xs', w.daysLeft <= 30 ? 'text-amber-600' : 'text-gray-400')}>{w.daysLeft === 0 ? 'today' : `${w.daysLeft} d`}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={card}>
          <SectionHeader
            title="Awaiting acknowledgement"
            subtitle={pendingAcks ? `${pendingAcks} hand-over${pendingAcks === 1 ? '' : 's'} not yet confirmed by the employee` : 'Employees confirm receipt in My Assets'}
            href="/admin/inventory/assets?ack=PENDING"
          />
          {data.acknowledgements.items.length === 0 ? (
            <ListEmpty>Every assigned asset has been acknowledged.</ListEmpty>
          ) : (
            <ul className="divide-y divide-gray-50 pb-2">
              {data.acknowledgements.items.map(a => (
                <li key={a.id}>
                  <Link href={`/admin/inventory/assets/${a.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50/60">
                    <CalendarClock className={cn('w-4 h-4 shrink-0', a.daysWaiting > 7 ? 'text-amber-500' : 'text-gray-400')} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 truncate">{a.employee ?? 'Employee'}</p>
                      <p className="text-xs text-gray-500 truncate"><span className="font-mono">{a.assetTag}</span> · {a.name}</p>
                    </div>
                    <span className={cn('text-xs shrink-0', a.daysWaiting > 7 ? 'text-amber-600 font-medium' : 'text-gray-400')}>
                      {a.daysWaiting == null ? '' : a.daysWaiting === 0 ? 'today' : `${a.daysWaiting} d`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={card}>
          <SectionHeader title="Recent activity" subtitle="Latest asset events" />
          {data.recentEvents.length === 0 ? (
            <ListEmpty>No activity yet.</ListEmpty>
          ) : (
            <ul className="divide-y divide-gray-50 pb-2">
              {data.recentEvents.map(e => (
                <li key={e.id}>
                  <Link href={e.assetId ? `/admin/inventory/assets/${e.assetId}` : '#'} className="flex items-start gap-3 px-5 py-2.5 hover:bg-gray-50/60">
                    <AssetEventIcon type={e.type} size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 truncate">
                        {EVENT_META[e.type]?.label ?? e.type}
                        {e.toStatus && e.fromStatus && e.toStatus !== e.fromStatus ? <span className="text-gray-400"> → {STATUS_META[e.toStatus]?.label ?? e.toStatus}</span> : null}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        <span className="font-mono">{e.assetTag ?? '—'}</span>{e.assetName ? ` · ${e.assetName}` : ''}{e.by ? ` · ${e.by}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{fmtAgo(e.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Stock + quick links */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className={cn(card, 'p-5')}>
          <h2 className="text-sm font-semibold text-gray-900">Consumable stock</h2>
          <p className="text-xs text-gray-500 mt-0.5">Moving-average cost</p>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-gray-500">Items</dt>
              <dd className="text-lg font-semibold text-gray-900">{data.stock.items}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Stock value</dt>
              <dd className="text-lg font-semibold text-gray-900">{fmtTk(data.stock.value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">At / below reorder level</dt>
              <dd className={cn('text-lg font-semibold', data.stock.lowStock ? 'text-amber-600' : 'text-gray-900')}>{data.stock.lowStock}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Out of stock</dt>
              <dd className={cn('text-lg font-semibold', data.stock.outOfStock ? 'text-red-600' : 'text-gray-900')}>{data.stock.outOfStock}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/admin/inventory/stock" className="text-xs font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">Open stock</Link>
            <Link href="/admin/inventory/reports?type=stock-valuation" className="text-xs font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">Valuation</Link>
          </div>
        </div>

        <div className={cn(card, 'lg:col-span-2 p-5')}>
          <h2 className="text-sm font-semibold text-gray-900">Go to</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {QUICK_LINKS.filter(q => ready && canAny(q.perm)).map(q => (
              <Link key={q.href} href={q.href} className="group flex items-start gap-3 rounded-lg border border-gray-100 p-3 hover:border-gray-200 hover:bg-gray-50/60">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-white">
                  <q.icon className="w-4 h-4 text-gray-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{q.label}</p>
                  <p className="text-xs text-gray-500">{q.hint}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const ALERT_TONES = {
  amber: 'bg-amber-50 text-amber-800 border-amber-100',
  orange: 'bg-orange-50 text-orange-800 border-orange-100',
  red: 'bg-red-50 text-red-800 border-red-100',
}

function Alert({ href, text, tone = 'amber' }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2 rounded-xl border px-4 py-3 text-sm hover:opacity-90', ALERT_TONES[tone])}>
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1">{text}</span>
      <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />
    </Link>
  )
}
