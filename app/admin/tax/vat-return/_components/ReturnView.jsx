'use client'

import Link from 'next/link'
import {
  FileSpreadsheet, AlertTriangle, Info, AlertOctagon, Receipt, Landmark, ArrowRight,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { periodLastDay } from '@/lib/finance/fiscal'
import NotesTable from './NotesTable'
import { fmtAmount, fmtDay, toNum, round2, RETURN_TYPE_LABELS, btnGhost } from '../_lib/format'

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
  danger:  { box: 'border-red-200 bg-red-50 text-red-800', Icon: AlertOctagon },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle },
  info:    { box: 'border-blue-100 bg-blue-50 text-blue-800', Icon: Info },
}

function Figure({ label, value, sub, onClick }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'text-left bg-white border border-gray-100 rounded-xl p-4 min-w-0',
        onClick && 'hover:border-gray-300 hover:shadow-sm transition',
      )}
    >
      <p className="text-xs font-medium text-gray-500 truncate">{label}</p>
      <p className="mt-1 text-lg sm:text-xl font-bold text-gray-900 tabular-nums truncate">Tk {fmtAmount(value ?? 0)}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400 truncate">{sub}</p>}
    </Comp>
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
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState icon={FileSpreadsheet} title="Nothing to show" description="Choose a return period above." />
      </div>
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

  return (
    <>
      {/* Key figures */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
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
        <div className={cn('rounded-xl p-5 border flex flex-col justify-between', balanceDue > 0.005 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200')}>
          <div>
            <p className={cn('text-xs font-semibold uppercase tracking-wide', balanceDue > 0.005 ? 'text-amber-800' : 'text-emerald-800')}>
              Net payable for treasury deposit (note 50)
            </p>
            <p className={cn('mt-1 text-3xl font-extrabold tabular-nums', balanceDue > 0.005 ? 'text-amber-900' : 'text-emerald-900')}>
              Tk {fmtAmount(n50)}
            </p>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-2"><span className="text-gray-600">Deposited (58)</span><span className="tabular-nums font-medium">Tk {fmtAmount(n58)}</span></div>
              {balanceDue > 0.005 ? (
                <div className="flex justify-between gap-2 text-red-700 font-semibold"><span>Still to pay</span><span className="tabular-nums">Tk {fmtAmount(balanceDue)}</span></div>
              ) : (
                <div className="flex justify-between gap-2 text-emerald-800 font-semibold"><span>Closing balance (65)</span><span className="tabular-nums">Tk {fmtAmount(n[65] ?? 0)}</span></div>
              )}
              {toNum(n[67]) > 0 && (
                <div className="flex justify-between gap-2 text-gray-600"><span>Refund requested (67)</span><span className="tabular-nums">Tk {fmtAmount(n[67])}</span></div>
              )}
              {showSd && (
                <div className="pt-2 mt-2 border-t border-black/5 space-y-1">
                  <div className="flex justify-between gap-2"><span className="text-gray-600">Net payable SD (51)</span><span className="tabular-nums font-medium">Tk {fmtAmount(n51)}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-600">SD deposited (59)</span><span className="tabular-nums font-medium">Tk {fmtAmount(n59)}</span></div>
                  {sdBalanceDue > 0.005 ? (
                    <div className="flex justify-between gap-2 text-red-700 font-semibold"><span>SD still to pay</span><span className="tabular-nums">Tk {fmtAmount(sdBalanceDue)}</span></div>
                  ) : (
                    <div className="flex justify-between gap-2 text-emerald-800 font-semibold"><span>SD closing balance (66)</span><span className="tabular-nums">Tk {fmtAmount(n[66] ?? 0)}</span></div>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="mt-4 text-[11px] text-gray-600 flex items-start gap-1.5">
            <Landmark className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Pay by A-challan / e-payment to <span className="font-mono">{settings?.challanCode ?? '1/1133/0010/0311'}</span> (code {settings?.challanCodeNew ?? '1141101'}) before submitting.
              {showSd && <> SD goes to <span className="font-mono">{settings?.sdChallanCode ?? '1/1133/0010/0721'}</span> (code {settings?.sdChallanCodeNew ?? '1141103'}).</>}
            </span>
          </p>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => {
            const st = LEVEL_STYLES[w.level] ?? LEVEL_STYLES.info
            const link = warningLink(w, period)
            return (
              <div key={`${w.code}-${i}`} className={cn('flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm', st.box)}>
                <st.Icon className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="flex-1">{w.message}</p>
                {link && (
                  <Link href={link.href} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline">
                    {link.label} <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Treasury deposits (note 58) */}
      <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Treasury deposits for this return (note 58{showSd ? ' / 59' : ''})</h2>
            <p className="text-xs text-gray-500">VAT payments recorded in the tax ledger plus challans entered with the return{showSd ? ' — supplementary duty (SD) challans count in note 59' : ''}.</p>
          </div>
          {canFile && !filed && !showingFiled && shown.fileable !== false && (
            <button type="button" onClick={onEditChallans} className={btnGhost}>
              <Receipt className="w-4 h-4" /> Edit challans
            </button>
          )}
        </div>
        {deposits.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">
            No deposits yet.{balanceDue > 0.005 ? ` Pay Tk ${fmtAmount(balanceDue)} by A-challan / e-payment, then record the challan.` : ''}
            {sdBalanceDue > 0.005 ? ` Pay the SD of Tk ${fmtAmount(sdBalanceDue)} by its own challan and enter it as an SD challan.` : ''}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left font-medium px-4 py-2">Challan / token</th>
                  <th className="text-left font-medium px-3 py-2">Head</th>
                  <th className="text-left font-medium px-3 py-2">Date</th>
                  <th className="text-left font-medium px-3 py-2">Bank / branch</th>
                  <th className="text-left font-medium px-3 py-2">Account code</th>
                  <th className="text-left font-medium px-3 py-2">Source</th>
                  <th className="text-right font-medium px-4 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((l, i) => {
                  const sd = Number(l.note) === 59
                  return (
                    <tr key={`${l.id ?? l.challanNo ?? 'c'}-${i}`} className="border-b border-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{l.challanNo || l.documentNo || '—'}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{sd ? 'SD (59)' : 'VAT (58)'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDay(l.date) || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{[l.bank, l.branch].filter(Boolean).join(', ') || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{l.accountCode || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{l.source === 'CHALLAN' ? 'Entered with the return' : `Ledger ${l.entryNo ?? ''}`}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtAmount(l.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-2" colSpan={6}>Total VAT (note 58)</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtAmount(n58)}</td>
                </tr>
                {showSd && (
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-4 py-2" colSpan={6}>Total SD (note 59)</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtAmount(n59)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Notes */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-500">
          {showingFiled ? 'Showing the figures as filed.' : 'Live figures from the tax ledger.'} Click a note to see its entries.
        </p>
        <label className="inline-flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" className="rounded border-gray-300" checked={showAll} onChange={e => onShowAll(e.target.checked)} />
          Show every note (incl. goods / import / SD notes)
        </label>
      </div>
      <NotesTable result={shown} showAll={showAll} onDrill={onDrill} />

      {/* Amendment history */}
      {history.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Earlier versions of this return</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left font-medium px-4 py-2">Type</th>
                  <th className="text-left font-medium px-3 py-2">Submitted</th>
                  <th className="text-left font-medium px-3 py-2">Acknowledgement</th>
                  <th className="text-right font-medium px-3 py-2">Net payable (50)</th>
                  <th className="text-right font-medium px-3 py-2">Closing (65)</th>
                  <th className="text-left font-medium px-3 py-2">Replaced</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((h, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-2">{RETURN_TYPE_LABELS[h.returnType] ?? h.returnType ?? '—'}</td>
                    <td className="px-3 py-2">{fmtDay(h.filedAt) || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h.acknowledgementNo || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(h.netPayable)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(Math.max(0, (Number(h.closingBalance) || 0) - (Number(h.refundRequested) || 0)))}</td>
                    <td className="px-3 py-2 text-gray-500">{fmtDay(h.supersededAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
