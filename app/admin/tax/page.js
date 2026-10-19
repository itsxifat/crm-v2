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
import { tk, fmtDay, fmtPeriod, fetchJson, btnGhost, btnPrimary } from '@/components/tax/taxUi'
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
  danger:  { box: 'border-red-200 bg-red-50',     text: 'text-red-800',   Icon: AlertOctagon,  icon: 'text-red-500' },
  warning: { box: 'border-amber-200 bg-amber-50', text: 'text-amber-900', Icon: AlertTriangle, icon: 'text-amber-500' },
  info:    { box: 'border-blue-100 bg-blue-50',   text: 'text-blue-900',  Icon: Info,          icon: 'text-blue-500' },
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
    <div className="bg-white border border-gray-100 rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3.5 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">VAT — {vat.label}</h2>
          <p className="text-xs text-gray-500">Due {fmtDay(vat.dueDate)}{vat.provisional ? ' · provisional, the period is still open' : ''}{vat.filed ? ' · filed' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {vat.filed ? <TaxPill label="Filed" color="green" /> : <DaysLeftBadge daysLeft={vat.daysLeft} />}
        </div>
      </div>
      <dl className="divide-y divide-gray-50">
        {rows.map(r => (
          <div key={r.label} className={cn('flex items-center justify-between gap-3 px-4 sm:px-5 py-2 text-sm', r.strong && 'bg-gray-50/60')}>
            <dt className={r.strong ? 'font-medium text-gray-900' : 'text-gray-600'}>{r.label}</dt>
            <dd className={cn('tabular-nums', r.strong ? 'font-semibold text-gray-900' : 'text-gray-700')}>
              {r.value < 0 ? `− ${tk(-r.value)}` : tk(r.value)}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3">
          <dt className="text-sm font-semibold text-gray-900">{vat.balanceDue > 0 ? 'Still to pay' : 'Carried forward (65)'}</dt>
          <dd className={cn('text-base font-bold tabular-nums', vat.balanceDue > 0 ? 'text-red-700' : 'text-gray-900')}>{tk(vat.balanceDue > 0 ? vat.balanceDue : (vat.carryForward ?? vat.closingBalance))}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 px-4 sm:px-5 py-3 border-t border-gray-100">
        <Link href={`/admin/tax/vat-return?start=${vat.start}&end=${vat.end}`} className={btnGhost}>Open return <ArrowRight className="w-3.5 h-3.5" /></Link>
        {canPay && !vat.provisional && vat.balanceDue > 0 && (
          <button type="button" className={btnPrimary} onClick={() => onPay(vat)}><Landmark className="w-4 h-4" /> Pay {tk(vat.balanceDue)}</button>
        )}
      </div>
      {vat.warnings?.length > 0 && (
        <ul className="px-4 sm:px-5 pb-3 space-y-1.5">
          {vat.warnings.slice(0, 4).map(w => (
            <li key={w.code} className={cn('flex items-start gap-1.5 text-xs', w.level === 'danger' ? 'text-red-700' : 'text-amber-800')}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
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
        ? { label: 'Pay VAT now', onClick: () => setPayVat(v) }
        : { label: 'Open VAT return', href: `/admin/tax/vat-return?start=${v.start}&end=${v.end}` },
    }
  })()

  const tdsOver = d?.tdsPayable?.overdue?.count ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tax &amp; VAT</h1>
          <p className="text-sm text-gray-500">
            {d ? (
              <>
                {d.company.name ? `${d.company.name} · ` : ''}
                BIN {d.company.bin || <span className="text-red-600">not set</span>} · TIN {d.company.tin || <span className="text-red-600">not set</span>} · Income year {d.fiscalYear}
              </>
            ) : 'VAT, withholding tax and compliance deadlines at a glance.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white">
            <button type="button" className="p-2 text-gray-500 hover:text-gray-900" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous month">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm font-medium text-gray-900 min-w-[84px] text-center">{fmtPeriod(period)}</span>
            <button type="button" className="p-2 text-gray-500 hover:text-gray-900 disabled:opacity-30" onClick={() => setPeriod(shiftPeriod(period, 1))} disabled={period >= nowPeriod} aria-label="Next month">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button type="button" className={btnGhost} onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && !d && (
        <div className="bg-white border border-red-100 rounded-xl p-6 text-center">
          <AlertOctagon className="w-8 h-8 text-red-400 mx-auto" />
          <p className="mt-2 text-sm font-medium text-gray-900">The tax dashboard could not be loaded</p>
          <p className="text-sm text-gray-500">{error}</p>
          <button type="button" className={cn(btnPrimary, 'mt-4')} onClick={load}>Try again</button>
        </div>
      )}

      {/* Alerts */}
      {d?.alerts?.length > 0 && (
        <div className="space-y-2">
          {d.alerts.map((a, i) => {
            const s = ALERT_STYLE[a.level] ?? ALERT_STYLE.info
            return (
              <div key={i} className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border px-4 py-3', s.box)}>
                <div className={cn('flex items-start gap-2 text-sm', s.text)}>
                  <s.Icon className={cn('w-4 h-4 mt-0.5 shrink-0', s.icon)} />
                  <span>{a.message}</span>
                </div>
                {a.href && a.action && (
                  <Link href={a.href} className="self-start sm:self-auto shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/80 border border-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-white">
                    {a.action} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}
      {d && d.alerts?.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CalendarCheck className="w-4 h-4" /> All caught up — no overdue deposits, returns or certificates.
        </div>
      )}

      {/* KPI cards */}
      {(d || loading) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <TaxKpiCard loading={loading && !d} {...vatCard} />
          <TaxKpiCard
            loading={loading && !d}
            icon={ArrowDownToLine}
            color="teal"
            title="Input VAT credit available"
            value={tk(d?.inputCredit?.unclaimed)}
            badge={d?.inputCredit?.expiringNextPeriod?.count > 0 ? <TaxPill label={`${d.inputCredit.expiringNextPeriod.count} expiring`} color="amber" /> : null}
            sub={d ? `${d.inputCredit.count} unclaimed credit${d.inputCredit.count === 1 ? '' : 's'}${d.inputCredit.expiringNextPeriod.count ? ` · ${tk(d.inputCredit.expiringNextPeriod.amount)} expire by ${fmtPeriod(d.inputCredit.expiringNextPeriod.by)}` : ''}` : null}
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
            sub={d ? `${d.vdsReceivable.pendingCertificates.count} deduction${d.vdsReceivable.pendingCertificates.count === 1 ? '' : 's'} by customers without Mushak-6.6 · ${tk(d.vdsReceivable.received.amount)} ready to claim` : null}
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
            sub={d ? `${d.tdsReceivable.count} deduction${d.tdsReceivable.count === 1 ? '' : 's'} by customers — credit against income tax` : null}
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
              : `${d.tdsPayable.undeposited.count} deduction${d.tdsPayable.undeposited.count === 1 ? '' : 's'} waiting for a challan`) : null}
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
            sub={d ? `${d.advanceTax.count} payment${d.advanceTax.count === 1 ? '' : 's'}${d.advanceTax.instalmentsPaid?.length ? ` · instalment${d.advanceTax.instalmentsPaid.length === 1 ? '' : 's'} ${d.advanceTax.instalmentsPaid.join(', ')} paid` : ''}${d.advanceTax.nextDue ? ` · next instalment ${fmtDay(d.advanceTax.nextDue)}` : ''}` : null}
            action={canDeposit ? { label: 'Record payment', onClick: () => setAdvanceOpen(true) } : { label: 'Tax ledger', href: '/admin/tax/entries?entryType=ADVANCE_TAX' }}
          />
        </div>
      )}

      {/* Certificates & returns strip */}
      {d && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/admin/tax/withholding?tab=vds-issue" className="bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">Mushak-6.6 to issue (suppliers)</p>
              <FileOutput className="w-4 h-4 text-gray-300" />
            </div>
            <p className="mt-1 text-lg font-semibold text-gray-900">{d.vdsPayable.certificatesToIssue.count} <span className="text-sm font-normal text-gray-500">· {tk(d.vdsPayable.certificatesToIssue.amount)}</span></p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {d.vdsPayable.certificatesToIssue.ready > 0 && <TaxPill label={`${d.vdsPayable.certificatesToIssue.ready} ready`} color="blue" />}
              {d.vdsPayable.certificatesToIssue.overdue > 0 && <TaxPill label={`${d.vdsPayable.certificatesToIssue.overdue} overdue`} color="red" />}
              {d.vdsPayable.undeposited.count > 0 && <TaxPill label={`${d.vdsPayable.undeposited.count} to deposit`} color="amber" />}
            </div>
          </Link>
          <Link href="/admin/tax/withholding?tab=tds-certs" className="bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">TDS certificates to issue (payees)</p>
              <FileCheck className="w-4 h-4 text-gray-300" />
            </div>
            <p className="mt-1 text-lg font-semibold text-gray-900">{d.tdsPayable.certificatesToIssue.count} <span className="text-sm font-normal text-gray-500">· {tk(d.tdsPayable.certificatesToIssue.amount)}</span></p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {d.tdsPayable.certificatesToIssue.ready > 0 && <TaxPill label={`${d.tdsPayable.certificatesToIssue.ready} ready (deposited)`} color="blue" />}
              {d.tdsPayable.certificatesToIssue.overdue > 0 && <TaxPill label={`${d.tdsPayable.certificatesToIssue.overdue} overdue`} color="red" />}
            </div>
          </Link>
          {d.whtReturn && (
            <Link href={`/admin/tax/withholding?tab=wht-return&quarter=${d.whtReturn.key}`} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500">Withholding return — {d.whtReturn.label}</p>
                <ClipboardList className="w-4 h-4 text-gray-300" />
              </div>
              <p className="mt-1 text-lg font-semibold text-gray-900">{tk(d.whtReturn.totals.deducted)} <span className="text-sm font-normal text-gray-500">deducted</span></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
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
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 space-y-4">
            <ComplianceCalendar items={d?.calendar ?? []} loading={loading && !d} />
          </div>
          <div className="lg:col-span-2 space-y-4">
            {registered && d?.vat && <VatBreakdown vat={d.vat} canPay={canDeposit} onPay={setPayVat} />}
            <CashlessMeter data={d?.cashless} loading={loading && !d} corporateRate={d?.settings?.corporateRate ?? 27.5} cashlessRate={d?.settings?.cashlessRate ?? 25} />
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick links</h2>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_LINKS.filter(l => !l.perm || can(l.perm)).map(l => (
                  <Link key={l.href} href={l.href} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-200">
                    <l.icon className="w-4 h-4 text-gray-400" /> {l.label}
                  </Link>
                ))}
              </div>
            </div>
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
    <Suspense fallback={<div className="py-24 text-center text-sm text-gray-400">Loading…</div>}>
      <TaxDashboard />
    </Suspense>
  )
}
