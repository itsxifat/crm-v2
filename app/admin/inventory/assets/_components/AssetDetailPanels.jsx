'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, FileText, Loader2, Paperclip, Plus, Printer, Trash2, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import DocPreview from '@/components/ui/DocPreview'
import FileUpload from '@/components/ui/FileUpload'
import { InventoryBadge, AssetEventIcon } from '@/components/inventory/AssetStatusBadge'
import { cn } from '@/lib/utils'
import {
  EVENT_META, STATUS_META, CONDITION_META, DAMAGE_CAUSE_LABELS, RECOVERY_METHOD_LABELS, RECOVERY_STATUS_META,
  DEPRECIATION_METHOD_LABELS, DEPRECIATION_CONVENTION_LABELS, safeLinkUrl,
} from '@/lib/inventory/constants'
import { KIND_LABELS } from '@/lib/finance/constants'
import { periodLabelOf as rawPeriodLabel } from '@/lib/inventory/depreciationMath'

/** 'Oct 2026' for '2026-10' (falls back to the raw value instead of throwing). */
const periodLabelOf = (p) => { try { return rawPeriodLabel(p) } catch { return p ?? '' } }
import { Section, InfoRow, tk, fmtDay, fmtDateTime, inputCls, btnSecondary, apiJson } from './shared'

const statusLabel = (s) => STATUS_META[s]?.label ?? s
const condLabel = (c) => CONDITION_META[c]?.label ?? c
const empName = (e) => (e ? (e.name ?? e.employeeId ?? 'employee') : null)
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

// ── Timeline ─────────────────────────────────────────────────────────────────

const GROUPS = {
  custody: ['CREATED', 'RECEIVED', 'OPENING', 'ASSIGNED', 'RETURNED', 'TRANSFERRED', 'ACKNOWLEDGED', 'ACK_DECLINED', 'AUDIT_VERIFIED'],
  repairs: ['REPAIR_SENT', 'REPAIR_COMPLETED', 'DAMAGE_REPORTED', 'RECOVERY_UPDATED', 'LOST', 'STOLEN', 'FOUND'],
  money: ['DEPRECIATION', 'VALUE_ADJUSTED', 'SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED', 'RECOVERY_UPDATED'],
  notes: ['NOTE', 'UPDATED', 'RETIRED', 'REACTIVATED'],
}
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'custody', label: 'Custody' },
  { key: 'repairs', label: 'Repairs & damage' },
  { key: 'money', label: 'Value' },
  { key: 'notes', label: 'Notes & edits' },
]

/** One-line explanation of an event. */
export function eventSummary(e) {
  const d = e.details || {}
  const from = empName(e.fromEmployee)
  const to = empName(e.toEmployee)
  const toLoc = e.toLocationId?.name
  const fromLoc = e.fromLocationId?.name
  switch (e.type) {
    case 'CREATED':
    case 'RECEIVED':
      return [
        e.amount ? `Cost ${tk(e.amount)}` : null,
        d.batchSize > 1 ? `item ${d.position} of ${d.batchSize}` : null,
        d.isCapitalized === false ? 'expensed (not capitalized)' : null,
        toLoc ? `at ${toLoc}` : null,
      ].filter(Boolean).join(' · ')
    case 'OPENING':
      return [e.amount ? `Cost ${tk(e.amount)}` : null, d.opening ? `accumulated depreciation ${tk(d.opening.accumulatedDepreciation)} brought in` : null].filter(Boolean).join(' · ')
    case 'ASSIGNED': {
      const target = to ?? e.departmentId?.name ?? 'department'
      const parts = [d.reassign && from ? `${from} → ${target}` : `To ${target}`]
      if (e.departmentId?.name && to) parts.push(e.departmentId.name)
      if (toLoc) parts.push(toLoc)
      if (d.expectedReturnDate) parts.push(`return by ${fmtDay(d.expectedReturnDate)}`)
      if (d.atCreation) parts.push('at registration')
      return parts.join(' · ')
    }
    case 'RETURNED':
      return [from ? `From ${from}` : null, e.condition ? `condition ${condLabel(e.condition)}` : null, d.returnedBroken ? 'now damaged' : null, toLoc ? `to ${toLoc}` : null].filter(Boolean).join(' · ')
    case 'TRANSFERRED':
      return `${fromLoc ?? 'No location'} → ${toLoc ?? d.toLocationName ?? '—'}`
    case 'ACKNOWLEDGED':
    case 'ACK_DECLINED':
      return to ?? from ?? ''
    case 'REPAIR_SENT':
      return [d.vendorName ?? e.vendorId?.company ? `To ${d.vendorName ?? e.vendorId?.company}` : null, d.repairRef ? `job ${d.repairRef}` : null, d.expectedDate ? `expected ${fmtDay(d.expectedDate)}` : null].filter(Boolean).join(' · ')
    case 'REPAIR_COMPLETED':
      return [
        Number(d.cost) > 0 ? `Bill ${tk(d.cost)}` : 'No charge',
        d.capitalize ? 'added to cost' : null,
        d.daysInRepair != null ? `${plural(d.daysInRepair, 'day')} in repair` : null,
        `back to ${d.returnTo === 'ASSIGNED' ? (to ?? 'the holder') : 'stock'}`,
      ].filter(Boolean).join(' · ')
    case 'DAMAGE_REPORTED': {
      if (d.reportedByEmployee && !d.recovery) {
        return `Reported by the employee${d.reportType === 'NOT_WORKING' ? ' (not working)' : ''}${d.assessed ? ' — assessed' : ''}`
      }
      const rec = d.recovery || {}
      return [
        DAMAGE_CAUSE_LABELS[d.cause] ?? null,
        Number(d.assessedLoss) > 0 ? `loss ${tk(d.assessedLoss)}` : null,
        rec.method && rec.method !== 'NONE' ? `${RECOVERY_METHOD_LABELS[rec.method]}${Number(rec.amount) > 0 ? ` ${tk(rec.amount)}` : ''}` : null,
        e.responsibleEmployee?.name ? `responsible: ${e.responsibleEmployee.name}` : null,
      ].filter(Boolean).join(' · ')
    }
    case 'RECOVERY_UPDATED': {
      const via = d.method ? ` (${RECOVERY_METHOD_LABELS[d.method] ?? d.method})` : ''
      // A part payment is written with status PENDING — the case stays open for the balance.
      if (d.status === 'PENDING' && Number(d.amount) > 0) {
        return `Part recovered ${tk(d.amount)}${via}${Number(d.outstanding) > 0 ? ` · ${tk(d.outstanding)} still to recover` : ''}`
      }
      if (d.status === 'WAIVED' && Number(d.waivedAmount) > 0) {
        return `Waived ${tk(d.waivedAmount)}${Number(d.recoveredBefore) > 0 ? ` (after ${tk(d.recoveredBefore)} recovered)` : ''}${via}`
      }
      return `${RECOVERY_STATUS_META[d.status]?.label ?? d.status}${Number(d.amount) > 0 ? ` ${tk(d.amount)}` : ''}${via}`
    }
    case 'LOST':
    case 'STOLEN':
      return [d.description, d.gdNumber ? `GD ${d.gdNumber}` : null].filter(Boolean).join(' · ')
    case 'FOUND':
      return [toLoc ? `At ${toLoc}` : null, e.condition ? `condition ${condLabel(e.condition)}` : null].filter(Boolean).join(' · ')
    case 'RETIRED':
      return d.reason ?? ''
    case 'SOLD':
      return [
        d.buyerName ? `To ${d.buyerName}` : null,
        `for ${tk(d.proceeds)}${Number(d.vatAmount) > 0 ? ` + VAT ${tk(d.vatAmount)}` : ''}`,
        `book value ${tk(d.bookValue)}`,
        Number(d.gainLoss) >= 0 ? `gain ${tk(d.gainLoss)}` : `loss ${tk(Math.abs(d.gainLoss))}`,
      ].filter(Boolean).join(' · ')
    case 'SCRAPPED':
    case 'WRITTEN_OFF':
    case 'DONATED':
      return [
        e.type === 'DONATED' && d.buyerName ? `To ${d.buyerName}` : null,
        Number(d.proceeds) > 0 ? `scrap proceeds ${tk(d.proceeds)}` : null,
        `book value ${tk(d.bookValue)}`,
        d.reason,
      ].filter(Boolean).join(' · ')
    case 'DEPRECIATION':
      if (d.writeBack) return `${tk(Math.abs(Number(e.amount) || 0))} written back for ${d.period ? periodLabelOf(d.period) : ''} (posted after the disposal date)${d.accumulatedAfter != null ? ` · accumulated ${tk(d.accumulatedAfter)}` : ''}`
      return `${tk(e.amount)} for ${d.fromPeriod && d.fromPeriod !== d.period ? `${periodLabelOf(d.fromPeriod)} – ` : ''}${d.period ? periodLabelOf(d.period) : ''}${d.disposal ? ' (to disposal date)' : ''}${d.accumulatedAfter != null ? ` · accumulated ${tk(d.accumulatedAfter)}` : ''}`
    case 'VALUE_ADJUSTED':
      if (d.kind === 'IMPAIRMENT') return `Impairment ${tk(d.amount)} · book value ${tk(d.bookValueBefore)} → ${tk(d.bookValueAfter)}`
      if (d.kind === 'COST_CORRECTION') return `Cost ${tk(d.fromCost)} → ${tk(d.toCost)}`
      if (d.kind === 'CAPITALIZED_REPAIR') return `Repair ${tk(d.amount)} added · cost ${tk(d.fromCost)} → ${tk(d.toCost)}`
      return e.amount ? tk(e.amount) : ''
    case 'AUDIT_VERIFIED':
      return [d.result ?? null, d.auditNo ?? null].filter(Boolean).join(' · ')
    case 'UPDATED':
      return Array.isArray(d.changes)
        ? d.changes.slice(0, 4).map(c => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ') + (d.changes.length > 4 ? ` · +${d.changes.length - 4} more` : '')
        : ''
    default:
      return ''
  }
}

export function AssetTimeline({ events = [], assetId }) {
  const [filter, setFilter] = useState('all')
  const [showDep, setShowDep] = useState(false)
  const [limit, setLimit] = useState(30)
  const depCount = events.filter(e => e.type === 'DEPRECIATION').length

  const shown = useMemo(() => events.filter(e => {
    if (filter !== 'all' && !GROUPS[filter]?.includes(e.type)) return false
    if (e.type === 'DEPRECIATION' && !showDep && filter !== 'money') return false
    return true
  }), [events, filter, showDep])

  return (
    <Section title="History" description="Every change to this asset, newest first"
      actions={depCount > 0 && filter !== 'money' && (
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" className="rounded border-gray-300" checked={showDep} onChange={e => setShowDep(e.target.checked)} />
          Monthly depreciation ({depCount})
        </label>
      )}>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTERS.map(fl => (
          <button key={fl.key} type="button" onClick={() => setFilter(fl.key)}
            className={cn('px-2.5 py-1 rounded-md text-xs font-medium', filter === fl.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
            {fl.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No events in this view.</p>
      ) : (
        <ol className="relative">
          {shown.slice(0, limit).map((e, i) => {
            const meta = EVENT_META[e.type]
            const summary = eventSummary(e)
            const last = i === Math.min(shown.length, limit) - 1
            return (
              <li key={e.id} className="relative flex gap-3 pb-5">
                {!last && <span className="absolute left-4 top-8 bottom-0 w-px bg-gray-100" aria-hidden="true" />}
                <AssetEventIcon type={e.type} className="relative z-[1]" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="text-sm font-medium text-gray-900">
                      {meta?.label ?? e.type}
                      {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && (
                        <span className="ml-2 text-xs font-normal text-gray-400">{statusLabel(e.fromStatus)} → {statusLabel(e.toStatus)}</span>
                      )}
                    </p>
                    <time className="text-xs text-gray-400 whitespace-nowrap" dateTime={e.date}>{fmtDateTime(e.date)}</time>
                  </div>
                  {summary && <p className="text-sm text-gray-600 mt-0.5 break-words">{summary}</p>}
                  {e.notes && e.notes !== summary && e.notes !== e.details?.description && (
                    <p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap break-words border-l-2 border-gray-100 pl-2">{e.notes}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                    {e.createdByName && <span>by {e.createdByName}</span>}
                    {e.type === 'ASSIGNED' && e.toEmployee && (
                      <a href={`/api/inventory/assets/${assetId}/handover?eventId=${e.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                        <Printer className="w-3 h-3" /> Hand-over form
                      </a>
                    )}
                    {e.expense && (
                      <span className="inline-flex items-center gap-1">
                        Payment request {e.expense.expenseId}
                        <InventoryBadge label={e.expense.status.toLowerCase()} color={e.expense.status === 'PENDING' ? 'yellow' : e.expense.status === 'REJECTED' ? 'red' : 'green'} dot={false} className="py-0.5" />
                      </span>
                    )}
                    {(e.attachments ?? []).map((u, k) => (
                      <a key={`${u}-${k}`} href={safeLinkUrl(u) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                        <Paperclip className="w-3 h-3" /> {u.split('/').pop().slice(0, 18)}
                      </a>
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {shown.length > limit && (
        <button type="button" className={cn(btnSecondary, 'w-full')} onClick={() => setLimit(l => l + 50)}>
          Show {Math.min(50, shown.length - limit)} more
        </button>
      )}
    </Section>
  )
}

// ── Financials ───────────────────────────────────────────────────────────────

const STATE_BADGE = {
  POSTED:    { label: 'Posted', color: 'green' },
  DUE:       { label: 'Due — not posted', color: 'yellow' },
  CURRENT:   { label: 'This month', color: 'blue' },
  PROJECTED: { label: 'Projected', color: 'gray' },
}

export function FinancialsPanel({ asset, book, tax, ledger, taxEntries, initialTab = 'book' }) {
  const [tab, setTab] = useState(initialTab)
  const [allPosted, setAllPosted] = useState(false)
  const cost = Number(asset.cost) || 0
  const accumulated = Number(book?.accumulated ?? asset.depreciation?.accumulated ?? 0)
  const nbv = Math.max(0, cost - accumulated)
  const pct = cost > 0 ? Math.min(100, Math.round((accumulated / cost) * 100)) : 0
  const capitalized = asset.isCapitalized !== false

  const bookRows = useMemo(() => {
    const posted = (book?.posted ?? []).map(p => ({
      key: `p-${p.eventId}`, period: p.period, label: p.fromPeriod && p.fromPeriod !== p.period ? `${periodLabelOf(p.fromPeriod)} – ${periodLabelOf(p.period)}` : periodLabelOf(p.period),
      amount: p.amount, accumulated: p.accumulatedAfter, bookValue: p.bookValueAfter, state: 'POSTED', note: p.disposal ? 'to disposal date' : p.catchUp ? 'catch-up' : null,
    }))
    const visiblePosted = allPosted ? posted : posted.slice(-6)
    const projected = (book?.projection ?? []).map(r => ({
      key: `f-${r.period}`, period: r.period, label: periodLabelOf(r.period), amount: r.amount, accumulated: r.accumulated, bookValue: r.bookValue, state: r.state, note: null,
    }))
    return { rows: [...visiblePosted, ...projected], hidden: posted.length - visiblePosted.length }
  }, [book, allPosted])

  const tabs = [
    { key: 'book', label: 'Book depreciation' },
    { key: 'tax', label: 'Tax (Third Schedule)' },
    ...(ledger ? [{ key: 'ledger', label: `Ledger (${ledger.length})` }] : []),
  ]

  return (
    <Section title="Value & depreciation" bodyClassName="p-0">
      <div className="px-4 sm:px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
          <p className="text-xs text-gray-500">Cost</p>
          <p className="text-base font-semibold text-gray-900">{tk(cost)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
          <p className="text-xs text-gray-500">Accumulated depreciation</p>
          <p className="text-base font-semibold text-gray-900">{tk(accumulated)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
          <p className="text-xs text-gray-500">Net book value</p>
          <p className="text-base font-semibold text-gray-900">{capitalized ? tk(nbv) : tk(0)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
          <p className="text-xs text-gray-500">Tax WDV ({tax?.currentFiscalYear ?? '—'})</p>
          <p className="text-base font-semibold text-gray-900">{tax?.currentWdv != null ? tk(tax.currentWdv) : '—'}</p>
        </div>
      </div>
      {capitalized ? (
        <div className="px-4 sm:px-5 pb-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{pct}% depreciated</span>
            <span>{book?.endPeriod ? `Fully depreciated by ${periodLabelOf(book.endPeriod)}` : book?.fullyDepreciated ? 'Fully depreciated' : ''}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-gray-900 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <p className="px-4 sm:px-5 pb-4 text-xs text-gray-500">This item was expensed when bought (below the capitalization threshold or set as non-capital). It is tracked for custody only.</p>
      )}

      <div className="border-t border-gray-50 px-4 sm:px-5 pt-3 flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap', tab === t.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100')}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 sm:px-5 py-4">
        {tab === 'book' && (
          !book?.depreciates && !(book?.posted ?? []).length ? (
            <p className="text-sm text-gray-500">No book depreciation — {capitalized ? 'the method is “Not depreciated” or the cost is zero' : 'the item is not capitalized'}.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 mb-3">
                <span>Method: <b className="text-gray-700">{DEPRECIATION_METHOD_LABELS[book.method] ?? book.method}</b></span>
                {book.usefulLifeMonths && <span>Life: <b className="text-gray-700">{book.usefulLifeMonths} months</b></span>}
                {book.monthlyCharge != null && <span>Monthly: <b className="text-gray-700">{tk(book.monthlyCharge)}</b></span>}
                {Number(book.residualValue) > 0 && <span>Residual: <b className="text-gray-700">{tk(book.residualValue)}</b></span>}
                {book.startDate && <span>From: <b className="text-gray-700">{fmtDay(book.startDate)}</b></span>}
                <span>Posted through: <b className="text-gray-700">{book.lastPostedPeriod ? periodLabelOf(book.lastPostedPeriod) : 'not yet'}</b></span>
              </div>
              {bookRows.hidden > 0 && (
                <button type="button" className="text-xs text-blue-600 hover:underline mb-2" onClick={() => setAllPosted(true)}>Show {plural(bookRows.hidden, 'earlier posted month')}</button>
              )}
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left font-medium py-2 px-4 sm:px-2">Month</th>
                      <th className="text-right font-medium py-2 px-2">Charge</th>
                      <th className="text-right font-medium py-2 px-2">Accumulated</th>
                      <th className="text-right font-medium py-2 px-2">Book value</th>
                      <th className="text-right font-medium py-2 px-4 sm:px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {bookRows.rows.map(r => (
                      <tr key={r.key} className={cn(r.state === 'PROJECTED' && 'text-gray-500')}>
                        <td className="py-1.5 px-4 sm:px-2 whitespace-nowrap">{r.label}{r.note && <span className="ml-1 text-xs text-gray-400">({r.note})</span>}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{tk(r.amount)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.accumulated != null ? tk(r.accumulated) : '—'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.bookValue != null ? tk(r.bookValue) : '—'}</td>
                        <td className="py-1.5 px-4 sm:px-2 text-right"><InventoryBadge {...STATE_BADGE[r.state]} dot={false} className="py-0.5" /></td>
                      </tr>
                    ))}
                    {!bookRows.rows.length && (
                      <tr><td colSpan={5} className="py-4 text-center text-gray-400 text-sm">Nothing scheduled — the asset is fully depreciated or disposed of.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3">{DEPRECIATION_CONVENTION_LABELS[book.convention] ?? ''}. Monthly runs post these amounts to the ledger as non-cash “Depreciation”.</p>
            </>
          )
        )}

        {tab === 'tax' && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 mb-3">
              <span>Class: <b className="text-gray-700">{tax?.classLabel}</b></span>
              <span>Rate: <b className="text-gray-700">{tax?.rate}% {tax?.method === 'STRAIGHT_LINE' ? 'on cost (straight-line)' : 'on WDV'}</b></span>
              {tax?.costCap && <span>Cost cap: <b className="text-gray-700">{tk(tax.costCap)}</b></span>}
            </div>
            {!(tax?.rows ?? []).length ? (
              <p className="text-sm text-gray-500">No tax depreciation — {capitalized ? 'add a purchase date and cost to build the schedule' : 'expensed items are deducted in the year bought'}.</p>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left font-medium py-2 px-4 sm:px-2">Income year</th>
                      <th className="text-right font-medium py-2 px-2">Opening WDV</th>
                      <th className="text-right font-medium py-2 px-2">Rate</th>
                      <th className="text-right font-medium py-2 px-2">Allowance</th>
                      <th className="text-right font-medium py-2 px-2">Closing WDV</th>
                      <th className="text-left font-medium py-2 px-4 sm:px-2">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tax.rows.map(r => (
                      <tr key={r.fy} className={cn(r.projected && 'text-gray-400 italic')}>
                        <td className="py-1.5 px-4 sm:px-2 whitespace-nowrap">{r.fy}{r.projected && ' (projected)'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{tk(r.openingWdv)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.rate}%</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{tk(r.allowance)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{tk(r.closingWdv)}</td>
                        <td className="py-1.5 px-4 sm:px-2 text-xs text-gray-500">{r.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3">Income Tax Act 2023, Third Schedule: full-year allowance in the year of acquisition, none in the year of disposal; total never exceeds cost. This schedule supports the depreciation statement filed with the return.</p>
          </>
        )}

        {tab === 'ledger' && ledger && (
          <>
            {!ledger.length ? (
              <p className="text-sm text-gray-500">No ledger entries reference this asset yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left font-medium py-2 px-4 sm:px-2">Date</th>
                      <th className="text-left font-medium py-2 px-2">Entry</th>
                      <th className="text-left font-medium py-2 px-2">Kind</th>
                      <th className="text-right font-medium py-2 px-2">Amount</th>
                      <th className="text-left font-medium py-2 px-4 sm:px-2">Account</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ledger.map(t => (
                      <tr key={t.id}>
                        <td className="py-1.5 px-4 sm:px-2 whitespace-nowrap">{fmtDay(t.date)}</td>
                        <td className="py-1.5 px-2">
                          <p className="text-gray-900">{t.category}</p>
                          <p className="text-xs text-gray-400 font-mono">{t.txnId}</p>
                        </td>
                        <td className="py-1.5 px-2"><InventoryBadge label={KIND_LABELS[t.kind] ?? t.kind ?? 'Operating'} color={t.kind === 'NON_CASH' ? 'purple' : t.kind === 'ASSET_SALE' ? 'teal' : 'gray'} dot={false} className="py-0.5" /></td>
                        <td className={cn('py-1.5 px-2 text-right tabular-nums', t.type === 'INCOME' ? 'text-green-700' : 'text-gray-900')}>
                          {t.type === 'INCOME' ? '+' : '−'} {tk(t.amountBDT ?? t.amount)}
                        </td>
                        <td className="py-1.5 px-4 sm:px-2 text-xs text-gray-500">{t.accountId?.name ?? 'Non-cash'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(taxEntries ?? []).length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-700 mb-1">Tax entries</p>
                {taxEntries.map(t => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm py-1">
                    <span className="text-gray-700">{t.entryType.replace(/_/g, ' ')} <span className="text-xs text-gray-400 font-mono">{t.entryNo}</span>{t.status === 'VOID' && <span className="ml-1 text-xs text-red-500">void</span>}</span>
                    <span className="tabular-nums">{tk(t.amount)} <span className="text-xs text-gray-400">on {tk(t.baseAmount)} · {t.period}</span></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  )
}

// ── Damage & recovery ────────────────────────────────────────────────────────

export function DamagePanel({ cases = [], canResolve, canAssess, onResolve, onAssess }) {
  if (!cases.length) return null
  return (
    <Section title="Damage & recovery" description="Damage register (Labour Act 2006 s.125/127) — recoveries need a proper enquiry and never exceed the actual loss">
      <div className="space-y-3">
        {cases.map(c => {
          const st = RECOVERY_STATUS_META[c.recovery?.status]
          const awaiting = c.reportedByEmployee && !c.assessed
          return (
            <div key={c.eventId} className="border border-gray-100 rounded-lg p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {awaiting ? 'Problem reported by employee' : (DAMAGE_CAUSE_LABELS[c.cause] ?? 'Damage')}
                    <span className="ml-2 text-xs font-normal text-gray-400">{fmtDay(c.date)}</span>
                  </p>
                  {c.description && <p className="text-sm text-gray-600 mt-0.5 break-words">{c.description}</p>}
                </div>
                {awaiting
                  ? <InventoryBadge label="Awaiting assessment" color="orange" />
                  : st && <InventoryBadge label={st.label} color={st.color} />}
              </div>
              {!awaiting && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                  <div><p className="text-gray-400">Assessed loss</p><p className="text-gray-900 font-medium">{tk(c.assessedLoss)}</p></div>
                  <div><p className="text-gray-400">Responsible</p><p className="text-gray-900 font-medium">{c.responsibleEmployeeName ?? '—'}{c.liabilityPct != null && c.responsibleEmployeeName ? ` (${c.liabilityPct}%)` : ''}</p></div>
                  <div><p className="text-gray-400">Recovery</p><p className="text-gray-900 font-medium">{RECOVERY_METHOD_LABELS[c.recovery?.method] ?? '—'}{Number(c.recovery?.amount) > 0 ? ` · ${tk(c.recovery.amount)}` : ''}</p></div>
                  <div>
                    <p className="text-gray-400">Recovered</p>
                    <p className="text-gray-900 font-medium">{c.recovery?.recoveredAmount != null ? `${tk(c.recovery.recoveredAmount)} · ${fmtDay(c.recovery.recoveredAt)}` : '—'}</p>
                    {c.recovery?.status === 'PENDING' && Number(c.recovery?.recoveredAmount) > 0 && Number(c.recovery?.outstanding) > 0 && (
                      <p className="text-amber-700">Balance {tk(c.recovery.outstanding)}</p>
                    )}
                    {c.recovery?.status === 'WAIVED' && Number(c.recovery?.waivedAmount) > 0 && (
                      <p className="text-gray-500">Waived {tk(c.recovery.waivedAmount)}</p>
                    )}
                  </div>
                </div>
              )}
              {c.enquiryNote && <p className="text-xs text-gray-500 mt-2"><b className="text-gray-600">Enquiry:</b> {c.enquiryNote}</p>}
              {c.recovery?.note && <p className="text-xs text-gray-500 mt-1"><b className="text-gray-600">Note:</b> {c.recovery.note}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {c.attachments.map((u, k) => (
                  <a key={`${u}-${k}`} href={safeLinkUrl(u) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <Paperclip className="w-3 h-3" /> {u.split('/').pop().slice(0, 18)}
                  </a>
                ))}
                <span className="flex-1" />
                {awaiting && canAssess && <button type="button" className={cn(btnSecondary, 'py-1.5 text-xs')} onClick={() => onAssess(c)}>Assess damage</button>}
                {c.recovery?.status === 'PENDING' && canResolve && (
                  <button type="button" className={cn(btnSecondary, 'py-1.5 text-xs')} onClick={() => onResolve(c)}>Record recovery / waive</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ── Documents ────────────────────────────────────────────────────────────────

export function DocumentsPanel({ asset, canManage, onSaved }) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const docs = asset.documents ?? []
  const editable = canManage && !asset.isArchived

  async function save(patch, okMsg) {
    setSaving(true)
    try {
      const json = await apiJson(`/api/inventory/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify(patch) })
      toast.success(okMsg)
      onSaved?.(json.data)
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = async () => {
    if (!url) return
    const ok = await save({ documents: [...docs.map(d => ({ label: d.label ?? null, url: d.url })), { label: label.trim() || null, url }] }, 'Document added')
    if (ok) { setLabel(''); setUrl(''); setAdding(false) }
  }
  const remove = (i) => save({ documents: docs.filter((_, j) => j !== i).map(d => ({ label: d.label ?? null, url: d.url })) }, 'Document removed')

  return (
    <Section title="Photo & documents"
      actions={editable && !adding && <button type="button" className={cn(btnSecondary, 'py-1.5 text-xs')} onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5" /> Add</button>}>
      {safeLinkUrl(asset.imageUrl) && <DocPreview url={safeLinkUrl(asset.imageUrl)} label="Photo" className="mb-3" />}
      {docs.length === 0 && !asset.imageUrl && !adding && (
        <p className="text-sm text-gray-400">No documents yet — attach the invoice, warranty card or hand-over scan.</p>
      )}
      <ul className="space-y-2">
        {docs.map((d, i) => (
          <li key={`${d.url}-${i}`} className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
            <a href={safeLinkUrl(d.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-sm text-blue-600 hover:underline">{d.label || d.url.split('/').pop()}</a>
            <ExternalLink className="w-3.5 h-3.5 text-gray-300" />
            {editable && (
              <button type="button" disabled={saving} className="p-1 text-gray-400 hover:text-red-500" onClick={() => remove(i)} aria-label="Remove document">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <div className="mt-3 space-y-2 border-t border-gray-50 pt-3">
          <input className={inputCls} placeholder="Label (e.g. Invoice, Warranty card)" value={label} onChange={e => setLabel(e.target.value)} />
          <FileUpload label={null} value={url} onUploaded={setUrl} bucket="assets" />
          <div className="flex justify-end gap-2">
            <button type="button" className={cn(btnSecondary, 'py-1.5 text-xs')} onClick={() => { setAdding(false); setUrl(''); setLabel('') }}>Cancel</button>
            <button type="button" className={cn(btnSecondary, 'py-1.5 text-xs')} disabled={!url || saving} onClick={add}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

// ── Purchase & details ───────────────────────────────────────────────────────

export function PurchasePanel({ asset }) {
  const p = asset.purchase ?? {}
  const bill = p.billId && typeof p.billId === 'object' ? p.billId : null
  const exp = p.expenseId && typeof p.expenseId === 'object' ? p.expenseId : null
  return (
    <Section title="Purchase & tax">
      <InfoRow label="Vendor">{p.vendorId?.company ?? p.vendorName}</InfoRow>
      <InfoRow label="Purchase date">{p.date ? fmtDay(p.date) : null}</InfoRow>
      <InfoRow label="Invoice / challan">{p.invoiceRef}</InfoRow>
      <InfoRow label="Mushak-6.3 no.">{p.mushakNo}</InfoRow>
      <InfoRow label="Unit cost (excl. VAT)">{Number(p.unitCost) > 0 ? tk(p.unitCost) : null}</InfoRow>
      <InfoRow label="VAT">{Number(p.vatAmount) > 0 ? `${tk(p.vatAmount)} · ${p.vatCapitalized === false ? 'claimed as input tax' : 'added to cost'}` : null}</InfoRow>
      <InfoRow label="Other costs">{Number(p.otherCosts) > 0 ? tk(p.otherCosts) : null}</InfoRow>
      <InfoRow label="Capitalized cost">{tk(asset.cost)}</InfoRow>
      <InfoRow label="Available for use">{asset.availableForUseDate ? fmtDay(asset.availableForUseDate) : null}</InfoRow>
      {bill && (
        <InfoRow label="Purchase bill">
          <Link href={`/admin/inventory/purchases/${bill.id}`} className="text-blue-600 hover:underline">{bill.billNo ?? 'View bill'}</Link>
        </InfoRow>
      )}
      {exp && <InfoRow label="Payment">{exp.expenseId} · {String(exp.status).toLowerCase()}</InfoRow>}
      {asset.opening?.isExisting && (
        <div className="mt-2 rounded-lg bg-indigo-50 text-indigo-800 text-xs px-3 py-2">
          Opening register: accumulated depreciation {tk(asset.opening.accumulatedDepreciation)} as of {fmtDay(asset.opening.asOfDate)}
          {asset.opening.taxWdv != null ? ` · tax WDV ${tk(asset.opening.taxWdv)}${asset.opening.taxWdvFiscalYear ? ` (${asset.opening.taxWdvFiscalYear})` : ''}` : ''}
        </div>
      )}
    </Section>
  )
}

export function DisposalSummary({ asset }) {
  const d = asset.disposal
  if (!d?.type) return null
  const gain = Number(d.gainLoss) || 0
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <TrendingDown className="w-4 h-4" /> {statusLabel(d.type)} on {fmtDay(d.date)}
      </div>
      <p className="text-sm text-gray-600 mt-1">
        {[
          d.buyerName ? `${d.type === 'DONATED' ? 'Recipient' : 'Buyer'}: ${d.buyerName}${d.buyerBin ? ` (BIN ${d.buyerBin})` : ''}` : null,
          d.proceeds != null && Number(d.proceeds) > 0 ? `Proceeds ${tk(d.proceeds)}${Number(d.vatAmount) > 0 ? ` + VAT ${tk(d.vatAmount)}` : ''}` : null,
          `Book value ${tk(d.bookValue)}`,
          gain >= 0 ? `Gain ${tk(gain)}` : `Loss ${tk(Math.abs(gain))}`,
          d.accountId?.name ? `Received into ${d.accountId.name}` : null,
        ].filter(Boolean).join(' · ')}
      </p>
      {d.reason && <p className="text-xs text-gray-500 mt-1">Reason: {d.reason}{d.approvedBy?.name ? ` · approved by ${d.approvedBy.name}` : ''}</p>}
    </div>
  )
}
