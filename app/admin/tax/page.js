'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, RefreshCw, Receipt, ArrowDownToLine, FileClock, BadgePercent, Landmark,
  CalendarCheck, AlertOctagon, AlertTriangle, Info, ArrowRight, FileSpreadsheet, BookOpen, Percent,
  FileCheck, FileMinus, ListChecks, Settings2, FileOutput, ClipboardList, CreditCard,
} from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import TaxKpiCard from '@/components/tax/TaxKpiCard'
import ComplianceCalendar from '@/components/tax/ComplianceCalendar'
import CashlessMeter from '@/components/tax/CashlessMeter'
import DepositModal from '@/components/tax/DepositModal'
import TaxEntryFormModal from '@/components/tax/TaxEntryFormModal'
import { TaxPill, DaysLeftBadge } from '@/components/tax/TaxBadges'
import { tk, fmtDay, fmtPeriod, fetchJson } from '@/components/tax/taxUi'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'

function currentPeriodKey() {
  const d = new Date(Date.now() + 6 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function shiftPeriod(p, delta) {
  const [y, m] = p.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

const ALERT_STYLE = {
  danger:  { box: 'border-red-200 bg-red-50 text-red-800',       Icon: AlertOctagon,  icon: 'text-red-600' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle, icon: 'text-amber-600' },
  info:    { box: 'border-blue-200 bg-blue-50 text-blue-800',    Icon: Info,          icon: 'text-blue-600' },
}

const QUICK_LINKS = [
  { href: '/admin/tax/vat-return',   label: 'VAT return 9.1',     icon: FileSpreadsheet },
  { href: '/admin/tax/registers',    label: 'Registers',          icon: BookOpen },
  { href: '/admin/tax/withholding',  label: 'Withholding',        icon: Percent },
  { href: '/admin/tax/certificates', label: 'Certificates',       icon: FileCheck },
  { href: '/admin/tax/notes',        label: 'Credit/debit notes', icon: FileMinus },
  { href: '/admin/tax/entries',      label: 'Tax ledger',         icon: ListChecks },
  { href: '/admin/tax/settings',     label: 'Tax settings',       icon: Settings2, perm: 'tax.manage' },
]

const tileCls = 'block rounded-xl border border-gray-200/80 bg-white p-5 shadow-xs transition-colors hover:border-gray-300'

function VatBreakdown({ vat, canPay, onPay }) {
  if (!vat) return null
  const rows = [
    { label: 'Output VAT (note 9)',             value: vat.output },
    { label: 'Input tax credit (note 23)',      value: -vat.input },
    { label: 'Increasing adjustments (28)',     value: vat.increasing },
    { label: 'Decreasing adjustments (33)',     value: -vat.decreasing },
    { label: 'Net VAT for the period (34)',     value: vat.netPayable, strong: true },
    { label: 'Previous closing balance (52)',   value: -vat.previousCredit },
    { label: 'Payable incl. interest (50)',     value: vat.estimatedPayable, strong: true },
    { label: 'Treasury deposits so far (58)',   value: -vat.deposits },
  ]
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="min-w-0">
          <CardTitle>VAT — {vat.label}</CardTitle>
          <CardDescription>Due {fmtDay(vat.dueDate)}{vat.provisional ? ' · provisional' : ''}{vat.filed ? ' · filed' : ''}</CardDescription>
        </div>
        <CardAction>
          {vat.filed ? <TaxPill label="Filed" color="green" /> : <DaysLeftBadge daysLeft={vat.daysLeft} />}
        </CardAction>
      </CardHeader>
      <dl className="divide-y divide-gray-100 border-t border-gray-100">
        {rows.map(r => (
          <div key={r.label} className={cn('flex items-center justify-between gap-3 px-5 py-2 text-sm', r.strong && 'bg-gray-50/60')}>
            <dt className={r.strong ? 'font-medium text-gray-900' : 'text-gray-600'}>{r.label}</dt>
            <dd className={cn('tabular-nums', r.strong ? 'font-semibold text-gray-900' : 'text-gray-700')}>
              {r.value < 0 ? `− ${tk(-r.value)}` : tk(r.value)}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <dt className="text-sm font-semibold text-gray-900">{vat.balanceDue > 0 ? 'Still to pay' : 'Carried forward (65)'}</dt>
          <dd className={cn('text-base font-semibold tabular-nums', vat.balanceDue > 0 ? 'text-red-700' : 'text-gray-900')}>{tk(vat.balanceDue > 0 ? vat.balanceDue : (vat.carryForward ?? vat.closingBalance))}</dd>
        </div>
      </dl>
      {vat.warnings?.length > 0 && (
        <ul className="space-y-1.5 border-t border-gray-100 px-5 py-3">
          {vat.warnings.slice(0, 4).map(w => (
            <li key={w.code} className={cn('flex items-start gap-1.5 text-xs', w.level === 'danger' ? 'text-red-700' : 'text-amber-800')}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w.message}
            </li>
          ))}
        </ul>
      )}
      <CardFooter className="flex-wrap">
        <Button variant="outline" size="sm" href={`/admin/tax/vat-return?start=${vat.start}&end=${vat.end}`}>Open return <ArrowRight /></Button>
        {canPay && !vat.provisional && vat.balanceDue > 0 && (
          <Button size="sm" onClick={() => onPay(vat)}><Landmark /> Pay {tk(vat.balanceDue)}</Button>
        )}
      </CardFooter>
    </Card>
  )
}

function TaxDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermission()
  const nowPeriod = currentPeriodKey()
  const qp = searchParams.get('period')
  const period = qp && /^\d{4}-\d{2}$/.test(qp) && qp <= nowPeriod ? qp : nowPeriod

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [payVat, setPayVat] = useState(null)
  const [advanceOpen, setAdvanceOpen] = useState(false)

  const seq = useRef(0)
  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson(`/api/tax/summary?period=${period}`)
      if (my === seq.current) setData(json.data)
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const setPeriod = (p) => {
    const params = new URLSearchParams(searchParams.toString())
    if (p === nowPeriod) params.delete('period')
    else params.set('period', p)
    const qs = params.toString()
    router.replace(qs ? `/admin/tax?${qs}` : '/admin/tax', { scroll: false })
  }

  const d = data
  const canDeposit = can('tax.deposits.manage')
  const registered = (d?.settings?.registrationType ?? 'REGISTERED') === 'REGISTERED'

  // VAT KPI: the return due next, else the selected period
  const vatCardSource = d?.vatDue ?? d?.vat ?? null
  const vatCard = (() => {
    if (!d) return { title: 'VAT payable', value: '—' }
    if (!registered) {
      return {
        title: 'VAT', value: 'Not registered', color: 'gray', icon: Receipt,
        sub: d.settings.registrationType === 'TURNOVER' ? 'Turnover-tax unit — no Mushak-9.1' : 'No VAT registration — no Mushak-9.1',
        action: can('tax.manage') ? { label: 'Tax settings', href: '/admin/tax/settings' } : null,
      }
    }
    if (!vatCardSource) {
      return { title: 'VAT payable', value: '—', icon: Receipt, color: 'blue', sub: d.vatError ?? 'Could not compute the return' }
    }
    const v = vatCardSource
    const isDue = !!d.vatDue
    return {
      title: isDue ? `VAT payable — ${v.label} return` : `Estimated VAT — ${v.label}`,
      value: tk(isDue ? v.balanceDue : v.estimatedPayable),
      icon: Receipt,
      color: 'blue',
      emphasis: v.overdue ? 'danger' : (v.daysLeft !== null && v.daysLeft <= 5 && !v.filed ? 'warning' : null),
      badge: v.filed ? <TaxPill label="Filed" color="green" /> : <DaysLeftBadge daysLeft={v.daysLeft} />,
      sub: isDue
        ? `Due ${fmtDay(v.dueDate)}${d.vat && d.vat.key !== v.key ? ` · ${d.vat.label} so far ${tk(d.vat.estimatedPayable)}` : ''}`
        : `Output ${tk(v.output)} · input ${tk(v.input)}${v.provisional ? ' · provisional' : ''}`,
      action: isDue && canDeposit && v.balanceDue > 0
        ? { label: 'Pay VAT', onClick: () => setPayVat(v) }
        : { label: 'Open VAT return', href: `/admin/tax/vat-return?start=${v.start}&end=${v.end}` },
    }
  })()

  const tdsOver = d?.tdsPayable?.overdue?.count ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax & VAT"
        description={d ? (
          <>
            {d.company.name ? `${d.company.name} · ` : ''}
            BIN {d.company.bin || <span className="text-red-600">not set</span>} · TIN {d.company.tin || <span className="text-red-600">not set</span>} · Income year {d.fiscalYear}
          </>
        ) : null}
        actions={
          <>
            <div className="inline-flex h-9 items-center rounded-lg border border-input bg-white shadow-xs">
              <Button variant="ghost" size="icon-sm" className="text-gray-500" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous month">
                <ChevronLeft />
              </Button>
              <span className="min-w-[84px] px-1 text-center text-sm font-medium tabular-nums text-gray-900">{fmtPeriod(period)}</span>
              <Button variant="ghost" size="icon-sm" className="text-gray-500" onClick={() => setPeriod(shiftPeriod(period, 1))} disabled={period >= nowPeriod} aria-label="Next month">
                <ChevronRight />
              </Button>
            </div>
            <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh">
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
          </>
        }
      />

      {error && !d && (
        <Card>
          <EmptyState
            icon={AlertOctagon}
            title="Couldn't load the tax dashboard"
            description={error}
            action={<Button onClick={load}>Try again</Button>}
          />
        </Card>
      )}

      {/* Alerts */}
      {d?.alerts?.length > 0 && (
        <div className="space-y-2">
          {d.alerts.map((a, i) => {
            const s = ALERT_STYLE[a.level] ?? ALERT_STYLE.info
            return (
              <div key={i} className={cn('flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between', s.box)}>
                <div className="flex items-start gap-2">
                  <s.Icon className={cn('mt-0.5 size-4 shrink-0', s.icon)} />
                  <span>{a.message}</span>
                </div>
                {a.href && a.action && (
                  <Link href={a.href} className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'self-start sm:self-auto')}>
                    {a.action} <ArrowRight />
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}
      {d && d.alerts?.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <CalendarCheck className="size-4 shrink-0 text-emerald-600" /> All caught up — nothing overdue.
        </div>
      )}

      {/* KPI cards */}
      {(d || loading) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <TaxKpiCard loading={loading && !d} {...vatCard} />
          <TaxKpiCard
            loading={loading && !d}
            icon={ArrowDownToLine}
            color="teal"
            title="Input VAT credit available"
            value={tk(d?.inputCredit?.unclaimed)}
            badge={d?.inputCredit?.expiringNextPeriod?.count > 0 ? <TaxPill label={`${d.inputCredit.expiringNextPeriod.count} expiring`} color="amber" /> : null}
            sub={d ? `${d.inputCredit.count} unclaimed${d.inputCredit.expiringNextPeriod.count ? ` · ${tk(d.inputCredit.expiringNextPeriod.amount)} expire by ${fmtPeriod(d.inputCredit.expiringNextPeriod.by)}` : ''}` : null}
            emphasis={d?.inputCredit?.expiringNextPeriod?.count > 0 ? 'warning' : null}
            action={{ label: 'Purchase register', href: '/admin/tax/registers?type=purchases' }}
          />
          <TaxKpiCard
            loading={loading && !d}
            icon={FileClock}
            color="indigo"
            title="VDS certificates to collect"
            value={tk(d?.vdsReceivable?.pendingCertificates?.amount)}
            badge={d?.vdsReceivable?.expiring?.count > 0 ? <TaxPill label={`${d.vdsReceivable.expiring.count} expiring`} color="amber" /> : null}
            sub={d ? `${d.vdsReceivable.pendingCertificates.count} without Mushak-6.6 · ${tk(d.vdsReceivable.received.amount)} ready to claim` : null}
            emphasis={d?.vdsReceivable?.expiring?.count > 0 ? 'warning' : null}
            action={{ label: 'Collect 6.6', href: '/admin/tax/withholding?tab=vds-receivable' }}
          />
          <TaxKpiCard
            loading={loading && !d}
            icon={BadgePercent}
            color="purple"
            title={`AIT credit — FY ${d?.tdsReceivable?.fy ?? ''}`}
            value={tk(d?.tdsReceivable?.amount)}
            badge={d?.tdsReceivable?.pendingCertificates?.count > 0 ? <TaxPill label={`${d.tdsReceivable.pendingCertificates.count} certificates missing`} color="amber" /> : null}
            sub={d ? `${d.tdsReceivable.count} deduction${d.tdsReceivable.count === 1 ? '' : 's'} by customers` : null}
            action={{ label: 'View AIT credits', href: '/admin/tax/withholding?tab=ait' }}
          />
          <TaxKpiCard
            loading={loading && !d}
            icon={Landmark}
            color="amber"
            title="TDS to deposit"
            value={tk(d?.tdsPayable?.undeposited?.amount)}
            badge={tdsOver > 0
              ? <TaxPill label={`${tdsOver} overdue`} color="red" />
              : d?.tdsPayable?.nextDue ? <TaxPill label={`Next due ${fmtDay(d.tdsPayable.nextDue)}`} color="gray" dot={false} /> : null}
            sub={d ? (tdsOver > 0
              ? `${tk(d.tdsPayable.overdue.amount)} overdue · interest ≈ ${tk(d.tdsPayable.overdue.interestEstimate)}`
              : `${d.tdsPayable.undeposited.count} awaiting a challan`) : null}
            emphasis={tdsOver > 0 ? 'danger' : (d?.tdsPayable?.dueSoon?.count > 0 ? 'warning' : null)}
            action={d?.tdsPayable?.undeposited?.count > 0 ? { label: tdsOver > 0 ? 'Deposit now' : 'Deposit TDS', href: '/admin/tax/withholding?tab=tds-deposit' } : { label: 'Withholding', href: '/admin/tax/withholding' }}
          />
          <TaxKpiCard
            loading={loading && !d}
            icon={CreditCard}
            color="emerald"
            title={`Advance tax paid — FY ${d?.advanceTax?.fy ?? ''}`}
            value={tk(d?.advanceTax?.paid)}
            badge={d?.advanceTax?.nextDue ? <DaysLeftBadge daysLeft={d.advanceTax.nextDueDaysLeft} /> : null}
            sub={d ? `${d.advanceTax.count} payment${d.advanceTax.count === 1 ? '' : 's'}${d.advanceTax.instalmentsPaid?.length ? ` · instalment${d.advanceTax.instalmentsPaid.length === 1 ? '' : 's'} ${d.advanceTax.instalmentsPaid.join(', ')} paid` : ''}${d.advanceTax.nextDue ? ` · next ${fmtDay(d.advanceTax.nextDue)}` : ''}` : null}
            action={canDeposit ? { label: 'Record payment', onClick: () => setAdvanceOpen(true) } : { label: 'Tax ledger', href: '/admin/tax/entries?entryType=ADVANCE_TAX' }}
          />
        </div>
      )}

      {/* Certificates & returns strip */}
      {d && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link href="/admin/tax/withholding?tab=vds-issue" className={tileCls}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-muted-foreground">Mushak-6.6 to issue</p>
              <FileOutput className="size-4 text-gray-400" />
            </div>
            <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">{d.vdsPayable.certificatesToIssue.count} <span className="text-sm font-normal text-muted-foreground">· {tk(d.vdsPayable.certificatesToIssue.amount)}</span></p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.vdsPayable.certificatesToIssue.ready > 0 && <TaxPill label={`${d.vdsPayable.certificatesToIssue.ready} ready`} color="blue" />}
              {d.vdsPayable.certificatesToIssue.overdue > 0 && <TaxPill label={`${d.vdsPayable.certificatesToIssue.overdue} overdue`} color="red" />}
              {d.vdsPayable.undeposited.count > 0 && <TaxPill label={`${d.vdsPayable.undeposited.count} to deposit`} color="amber" />}
            </div>
          </Link>
          <Link href="/admin/tax/withholding?tab=tds-certs" className={tileCls}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-muted-foreground">TDS certificates to issue</p>
              <FileCheck className="size-4 text-gray-400" />
            </div>
            <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">{d.tdsPayable.certificatesToIssue.count} <span className="text-sm font-normal text-muted-foreground">· {tk(d.tdsPayable.certificatesToIssue.amount)}</span></p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.tdsPayable.certificatesToIssue.ready > 0 && <TaxPill label={`${d.tdsPayable.certificatesToIssue.ready} ready (deposited)`} color="blue" />}
              {d.tdsPayable.certificatesToIssue.overdue > 0 && <TaxPill label={`${d.tdsPayable.certificatesToIssue.overdue} overdue`} color="red" />}
            </div>
          </Link>
          {d.whtReturn && (
            <Link href={`/admin/tax/withholding?tab=wht-return&quarter=${d.whtReturn.key}`} className={tileCls}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-muted-foreground">Withholding return — {d.whtReturn.label}</p>
                <ClipboardList className="size-4 text-gray-400" />
              </div>
              <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">{tk(d.whtReturn.totals.deducted)} <span className="text-sm font-normal text-muted-foreground">deducted</span></p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.whtReturn.filing && ['FILED', 'AMENDED'].includes(d.whtReturn.filing.status)
                  ? <TaxPill label="Filed" color="green" />
                  : <><TaxPill label={`Due ${fmtDay(d.whtReturn.dueDate)}`} color="gray" dot={false} /><DaysLeftBadge daysLeft={d.whtReturn.daysLeft} /></>}
                {d.whtReturn.totals.pending > 0 && <TaxPill label={`${tk(d.whtReturn.totals.pending)} not deposited`} color="amber" />}
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Calendar + VAT + meter */}
      {(d || loading) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <ComplianceCalendar items={d?.calendar ?? []} loading={loading && !d} />
          </div>
          <div className="space-y-4 lg:col-span-2">
            {registered && d?.vat && <VatBreakdown vat={d.vat} canPay={canDeposit} onPay={setPayVat} />}
            <CashlessMeter data={d?.cashless} loading={loading && !d} corporateRate={d?.settings?.corporateRate ?? 27.5} cashlessRate={d?.settings?.cashlessRate ?? 25} />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Quick links</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                {QUICK_LINKS.filter(l => !l.perm || can(l.perm)).map(l => (
                  <Link key={l.href} href={l.href} className="flex items-center gap-2 rounded-lg border border-gray-200/80 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900">
                    <l.icon className="size-4 shrink-0 text-gray-500" /> <span className="truncate">{l.label}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <DepositModal
        open={!!payVat}
        onOpenChange={(o) => { if (!o) setPayVat(null) }}
        kind="VAT"
        returnPeriod={payVat ? { start: payVat.start, end: payVat.end, label: payVat.label } : null}
        defaultAmount={payVat?.balanceDue ?? null}
        onSaved={load}
      />
      <TaxEntryFormModal open={advanceOpen} onOpenChange={setAdvanceOpen} initialType="ADVANCE_TAX" types={['ADVANCE_TAX']} onSaved={load} />
    </div>
  )
}

export default function TaxDashboardPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <TaxDashboard />
    </Suspense>
  )
}
