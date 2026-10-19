'use client'

import Link from 'next/link'
import {
  FileSpreadsheet, AlertTriangle, Info, AlertOctagon, Receipt, Landmark, ArrowRight,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { periodLastDay } from '@/lib/finance/fiscal'
import NotesTable from './NotesTable'
import { fmtAmount, fmtDay, toNum, round2, RETURN_TYPE_LABELS } from '../_lib/format'

const WARNING_LINKS = {
  COMPANY_BIN_MISSING:      { href: '/admin/tax/settings', label: 'Tax settings' },
  BUYER_BIN_MISSING:        { href: '/admin/clients', label: 'Clients' },
  VDS_CERTIFICATE_PENDING:  { href: '/admin/tax/withholding', label: 'Withholding' },
  VDS_CERTIFICATE_TO_ISSUE: { href: '/admin/tax/withholding', label: 'Issue Mushak-6.6' },
  VDS_RECEIVABLE_EXPIRED:   { href: '/admin/tax/entries', label: 'Tax ledger' },
  INPUT_VAT_EXPIRED:        { href: '/admin/tax/entries', label: 'Tax ledger' },
  ADJUSTMENT_UNCLASSIFIED:  { href: '/admin/tax/entries', label: 'Tax ledger' },
  OUTPUT_VAT_UNCONVERTED:   { href: '/admin/tax/entries', label: 'Tax ledger' },
  NO_OPENING_BALANCE:       { href: '/admin/finance/opening-balances', label: 'Opening balances' },
}

/** 'YYYY-MM' or 'YYYY-MM..YYYY-MM' → VAT return page link. */
function returnHref(periodKey) {
  const [start, end] = String(periodKey ?? '').split('..')
  if (!/^\d{4}-\d{2}$/.test(start ?? '')) return null
  return `/admin/tax/vat-return?start=${start}&end=${/^\d{4}-\d{2}$/.test(end ?? '') ? end : start}`
}

function warningLink(w, period) {
  if (w.code === 'DISCLOSURE_6_10' && period) {
    return { href: `/admin/tax/registers?type=disclosure&start=${period.start}-01&end=${periodLastDay(period.end)}`, label: 'Mushak-6.10' }
  }
  if (w.code === 'PREVIOUS_RETURN_STALE' && w.periodKey) {
    const href = returnHref(w.periodKey)
    return href ? { href, label: `Open ${w.periodKey}` } : null
  }
  if ((w.code === 'PERIOD_OVERRIDE' || w.code === 'RETURN_OVERLAP') && w.suggest?.start) {
    return { href: `/admin/tax/vat-return?start=${w.suggest.start}&end=${w.suggest.end ?? w.suggest.start}`, label: `Open ${w.suggest.label ?? w.suggest.start}` }
  }
  return WARNING_LINKS[w.code] ?? null
}

const LEVEL_STYLES = {
  danger:  { box: 'border-red-200 bg-red-50 text-red-800', Icon: AlertOctagon, icon: 'text-red-600' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle, icon: 'text-amber-600' },
  info:    { box: 'border-blue-200 bg-blue-50 text-blue-800', Icon: Info, icon: 'text-blue-600' },
}

function Figure({ label, value, sub, onClick }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'min-w-0 rounded-xl border border-gray-200/80 bg-white p-4 text-left shadow-xs',
        onClick && 'transition-colors hover:border-gray-300 hover:bg-gray-50/60',
      )}
    >
      <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tracking-tight text-gray-900 tabular-nums sm:text-xl">Tk {fmtAmount(value ?? 0)}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </Comp>
  )
}

function SumRow({ label, value, className }) {
  return (
    <div className={cn('flex justify-between gap-2', className)}>
      <span>{label}</span>
      <span className="tabular-nums">Tk {fmtAmount(value)}</span>
    </div>
  )
}

/**
 * Body of the VAT return page for one computed return (live or as filed):
 * key figures with the highlighted net payable, warnings, treasury deposits,
 * the Mushak-9.1 notes by Part (drill-down per note) and earlier versions.
 */
export default function ReturnView({
  shown, period, settings, canFile, filed, showingFiled, showAll, onShowAll, onDrill, onEditChallans, history = [],
}) {
  if (!shown) {
    return (
      <Card>
        <EmptyState icon={FileSpreadsheet} title="Nothing to show" description="Choose a return period." />
      </Card>
    )
  }

  const n = shown.notes ?? {}
  const n50 = toNum(n[50])
  const n58 = toNum(n[58])
  const balanceDue = round2(Math.max(0, n50 - n58))
  // Supplementary duty is paid under its own code (note 59) against note 51.
  const n51 = toNum(n[51])
  const n59 = toNum(n[59])
  const sdBalanceDue = round2(Math.max(0, n51 - n59))
  const showSd = n51 > 0.005 || n59 > 0.005
  const deposits = shown.lines?.deposits ?? []
  const vatDepositCount = deposits.filter(l => Number(l.note ?? 58) !== 59).length
  const warnings = shown.warnings ?? []
  const prev = shown.previousSource
  const due = balanceDue > 0.005

  return (
    <>
      {/* Key figures */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2">
          <Figure label="Output VAT (9c)" value={n[9]?.c} sub={`Sales value Tk ${fmtAmount(n[9]?.a ?? 0)}`} />
          <Figure label="Input tax credit (23b)" value={n[23]?.b} sub={`${(shown.lines?.input ?? []).length} purchase(s)`} />
          <Figure label="Net adjustments (28 − 33)" value={round2(toNum(n[28]) - toNum(n[33]))} sub={`+${fmtAmount(n[28] ?? 0)} / −${fmtAmount(n[33] ?? 0)}`} />
          <Figure label="Net payable VAT (34)" value={n[34]} sub="9c − 23b + 28 − 33" />
          <Figure
            label="Previous closing balance (52)"
            value={n[52]}
            sub={prev?.type === 'FILING' ? `From the ${prev.periodKey} return` : prev?.type === 'OPENING' ? 'From opening balances' : 'No earlier return'}
            onClick={(shown.noteEntries?.[52] ?? []).length ? () => onDrill(52) : undefined}
          />
          <Figure
            label="Treasury deposits (58)"
            value={n[58]}
            sub={`${vatDepositCount} challan(s)`}
            onClick={(shown.noteEntries?.[58] ?? []).length ? () => onDrill(58) : undefined}
          />
        </div>
        <Card className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-medium text-muted-foreground">Net payable for treasury deposit (note 50)</p>
              <Badge variant={due ? 'warning' : 'success'} dot>{due ? 'Payment due' : 'Nothing due'}</Badge>
            </div>
            <p className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900 tabular-nums">
              Tk {fmtAmount(n50)}
            </p>
            <div className="mt-4 space-y-1.5 text-sm">
              <SumRow label="Deposited (58)" value={n58} className="text-gray-600" />
              {due ? (
                <SumRow label="Still to pay" value={balanceDue} className="font-semibold text-red-700" />
              ) : (
                <SumRow label="Closing balance (65)" value={n[65] ?? 0} className="font-semibold text-emerald-700" />
              )}
              {toNum(n[67]) > 0 && (
                <SumRow label="Refund requested (67)" value={n[67]} className="text-gray-600" />
              )}
              {showSd && (
                <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                  <SumRow label="Net payable SD (51)" value={n51} className="text-gray-600" />
                  <SumRow label="SD deposited (59)" value={n59} className="text-gray-600" />
                  {sdBalanceDue > 0.005 ? (
                    <SumRow label="SD still to pay" value={sdBalanceDue} className="font-semibold text-red-700" />
                  ) : (
                    <SumRow label="SD closing balance (66)" value={n[66] ?? 0} className="font-semibold text-emerald-700" />
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="mt-4 flex items-start gap-1.5 border-t border-gray-100 pt-3 text-xs text-muted-foreground">
            <Landmark className="mt-0.5 size-3.5 shrink-0" />
            <span>
              A-challan / e-payment: <span className="font-mono text-gray-700">{settings?.challanCode ?? '1/1133/0010/0311'}</span> (code {settings?.challanCodeNew ?? '1141101'})
              {showSd && <> · SD: <span className="font-mono text-gray-700">{settings?.sdChallanCode ?? '1/1133/0010/0721'}</span> (code {settings?.sdChallanCodeNew ?? '1141103'})</>}
            </span>
          </p>
        </Card>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => {
            const st = LEVEL_STYLES[w.level] ?? LEVEL_STYLES.info
            const link = warningLink(w, period)
            return (
              <div key={`${w.code}-${i}`} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm', st.box)}>
                <st.Icon className={cn('mt-0.5 size-4 shrink-0', st.icon)} />
                <p className="flex-1">{w.message}</p>
                {link && (
                  <Link href={link.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium underline-offset-4 hover:underline">
                    {link.label} <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Treasury deposits (note 58) */}
      <Card className="overflow-hidden">
        <CardHeader className="items-center pb-4">
          <CardTitle>Treasury deposits (note 58{showSd ? ' / 59' : ''})</CardTitle>
          {canFile && !filed && !showingFiled && shown.fileable !== false && (
            <CardAction>
              <Button variant="outline" size="sm" onClick={onEditChallans}>
                <Receipt /> Edit challans
              </Button>
            </CardAction>
          )}
        </CardHeader>
        {deposits.length === 0 ? (
          <p className="border-t border-gray-100 px-5 py-8 text-center text-sm text-muted-foreground">
            No deposits yet.{balanceDue > 0.005 ? ` Tk ${fmtAmount(balanceDue)} still to pay.` : ''}
            {sdBalanceDue > 0.005 ? ` SD Tk ${fmtAmount(sdBalanceDue)} still to pay by its own challan.` : ''}
          </p>
        ) : (
          <Table className="min-w-[640px]" wrapperClassName="border-t border-gray-100">
            <TableHeader>
              <TableRow>
                <TableHead>Challan / token</TableHead>
                <TableHead>Head</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Bank / branch</TableHead>
                <TableHead>Account code</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((l, i) => {
                const sd = Number(l.note) === 59
                return (
                  <TableRow key={`${l.id ?? l.challanNo ?? 'c'}-${i}`}>
                    <TableCell className="font-mono text-xs text-gray-900">{l.challanNo || l.documentNo || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{sd ? 'SD (59)' : 'VAT (58)'}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDay(l.date) || '—'}</TableCell>
                    <TableCell className="text-gray-600">{[l.bank, l.branch].filter(Boolean).join(', ') || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{l.accountCode || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.source === 'CHALLAN' ? 'Entered with the return' : `Ledger ${l.entryNo ?? ''}`}</TableCell>
                    <TableCell className="text-right tabular-nums text-gray-900">{fmtAmount(l.amount)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <tr className="font-semibold text-gray-900">
                <td className="px-4 py-2.5" colSpan={6}>Total VAT (note 58)</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmount(n58)}</td>
              </tr>
              {showSd && (
                <tr className="border-t border-gray-100 font-semibold text-gray-900">
                  <td className="px-4 py-2.5" colSpan={6}>Total SD (note 59)</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmount(n59)}</td>
                </tr>
              )}
            </TableFooter>
          </Table>
        )}
      </Card>

      {/* Notes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {showingFiled ? 'Figures as filed' : 'Live figures from the tax ledger'}
        </p>
        <label className="inline-flex items-center gap-2 text-[13px] text-gray-700" title="Includes goods, import and SD notes">
          <input type="checkbox" className="rounded border-gray-300" checked={showAll} onChange={e => onShowAll(e.target.checked)} />
          Show all notes
        </label>
      </div>
      <NotesTable result={shown} showAll={showAll} onDrill={onDrill} />

      {/* Amendment history */}
      {history.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle>Earlier versions of this return</CardTitle>
          </CardHeader>
          <Table className="min-w-[560px]" wrapperClassName="border-t border-gray-100">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Acknowledgement</TableHead>
                <TableHead className="text-right">Net payable (50)</TableHead>
                <TableHead className="text-right">Closing (65)</TableHead>
                <TableHead>Replaced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...history].reverse().map((h, i) => (
                <TableRow key={i}>
                  <TableCell className="text-gray-900">{RETURN_TYPE_LABELS[h.returnType] ?? h.returnType ?? '—'}</TableCell>
                  <TableCell>{fmtDay(h.filedAt) || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{h.acknowledgementNo || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAmount(h.netPayable)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAmount(Math.max(0, (Number(h.closingBalance) || 0) - (Number(h.refundRequested) || 0)))}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDay(h.supersededAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}
