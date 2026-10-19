'use client'

import Link from 'next/link'
import { BookOpen, ExternalLink, Info } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { fmtAmount, fmtQty, fmtDay } from '../../vat-return/_lib/format'

/**
 * Register body: header (form, rule, hint), summary chips and the table(s) in
 * official column order. Disclosure (Mushak-6.10) renders Part A and Part B.
 */
export default function RegisterView({ reg, showStock, loading }) {
  const columns = reg.columns.filter(c => c.key !== 'part' && (showStock || !c.stock))
  return (
    <div className={cn('space-y-4', loading && 'opacity-60 transition-opacity')}>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {reg.form ? `${reg.form} — ` : ''}{reg.title}
            <span className="ml-2 text-xs font-normal text-gray-500">{reg.label}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{reg.rule}</p>
          <p className="text-xs text-gray-500 mt-1 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{reg.hint}</p>
        </div>
        <Summary reg={reg} />
      </div>

      {reg.truncated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Only the first 10,000 rows are shown. Choose a shorter period.
        </div>
      )}

      {reg.type === 'disclosure' ? (
        ['A', 'B'].map(part => {
          const meta = reg.parts?.[part] ?? { title: `Part ${part}`, partyLabel: part === 'A' ? 'Seller' : 'Buyer' }
          const cols = columns.map(c => (['partyName', 'partyAddress', 'partyBin'].includes(c.key)
            ? { ...c, label: c.key === 'partyBin' ? `${meta.partyLabel} BIN / NID` : `${meta.partyLabel} ${c.label.toLowerCase()}` }
            : c))
          const rows = reg.rows.filter(r => r.part === part)
          return (
            <RegisterTable
              key={part}
              title={meta.title}
              columns={cols}
              rows={rows}
              totals={reg.totals?.[part]}
              numbered={reg.numbered}
              emptyText={`No ${part === 'A' ? 'purchase' : 'sale'} invoices above Tk 2,00,000 in this period.`}
            />
          )
        })
      ) : (
        <RegisterTable
          columns={columns}
          rows={reg.rows}
          totals={reg.totals}
          numbered={reg.numbered}
          emptyText={EMPTY_TEXT[reg.type]}
        />
      )}
    </div>
  )
}

const EMPTY_TEXT = {
  sales:     'No tax invoices, credit or debit notes in this period. Output VAT is recorded when an invoice is sent.',
  purchases: 'No received purchase bills, purchases with input VAT or paid supplier expenses in this period.',
  vds:       'No VAT deducted at source in this period.',
  tds:       'No income tax deducted at source in this period.',
}

function Summary({ reg }) {
  const s = reg.summary ?? {}
  const chips = []
  if (reg.type === 'sales') {
    chips.push(['Invoices', s.invoices ?? 0, null])
    chips.push(['Net taxable value', null, s.net?.taxableValue])
    chips.push(['Net VAT', null, s.net?.vat])
    if (s.credit?.count) chips.push([`Credit notes (${s.credit.count})`, null, -s.credit.vat])
  } else if (reg.type === 'purchases') {
    chips.push(['Bills', s.bills ?? 0, null])
    if (s.noVatPurchases) chips.push(['No-VAT purchases', s.noVatPurchases, null])
    chips.push(['Value', null, s.value])
    chips.push(['VAT', null, s.vat])
    chips.push(['Creditable VAT', null, s.creditableVat])
  } else if (reg.type === 'disclosure') {
    chips.push([`Part A (${s.A?.count ?? 0})`, null, s.A?.value])
    chips.push([`Part B (${s.B?.count ?? 0})`, null, s.B?.value])
  } else if (reg.type === 'vds') {
    chips.push([`By us (${s.byUs?.count ?? 0})`, null, s.byUs?.vds])
    chips.push([`By customers (${s.byCustomers?.count ?? 0})`, null, s.byCustomers?.vds])
    if (s.byUs?.certificatesToIssue) chips.push(['6.6 to issue', s.byUs.certificatesToIssue, null])
    if (s.byCustomers?.certificatesPending) chips.push(['6.6 to collect', s.byCustomers.certificatesPending, null])
  } else if (reg.type === 'tds') {
    chips.push([`By us (${s.byUs?.count ?? 0})`, null, s.byUs?.tds])
    chips.push([`By customers (${s.byCustomers?.count ?? 0})`, null, s.byCustomers?.tds])
    if (s.byUs?.undeposited) chips.push([`Not deposited (${s.byUs.undeposited})`, null, s.byUs.undepositedAmount])
  }
  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      {chips.map(([label, count, amount]) => (
        <div key={label} className="bg-white border border-gray-100 rounded-lg px-3 py-2 min-w-[120px]">
          <p className="text-[11px] text-gray-500">{label}</p>
          <p className="text-sm font-semibold text-gray-900 tabular-nums">{amount !== null && amount !== undefined ? `Tk ${fmtAmount(amount)}` : count}</p>
        </div>
      ))}
    </div>
  )
}

function linkFor(r) {
  if (r.invoiceId) return `/admin/invoices/${r.invoiceId}`
  if (r.purchaseBillId) return `/admin/inventory/purchases/${r.purchaseBillId}`
  // Paid expenses live on the Accounts page (same link as the tax ledger uses).
  if (r.expenseId) return '/admin/accounts?tab=requests'
  return null
}

function cellText(value, type) {
  if (type === 'money') return fmtAmount(value)
  if (type === 'qty') return fmtQty(value)
  if (type === 'date') return fmtDay(value)
  return value ?? ''
}

function RegisterTable({ title, columns, rows, totals, numbered, emptyText }) {
  const hasLinks = rows.some(linkFor)
  const hasTotals = rows.length > 0 && columns.some(c => c.total)
  return (
    <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      {title && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No entries" description={emptyText} className="py-12" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                {columns.map(c => (
                  <th key={c.key} className={cn('px-3 py-2 font-medium align-bottom', c.type === 'money' || c.type === 'qty' ? 'text-right' : 'text-left', c.type === 'text' && 'min-w-[120px]')}>
                    {c.label}
                  </th>
                ))}
                {hasLinks && <th className="w-8" />}
              </tr>
              {numbered && (
                <tr className="text-[10px] text-gray-400 border-b border-gray-100">
                  {columns.map(c => (
                    <th key={c.key} className={cn('px-3 pb-1 font-normal', c.type === 'money' || c.type === 'qty' ? 'text-right' : 'text-left')}>{c.no ?? ''}</th>
                  ))}
                  {hasLinks && <th />}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const href = linkFor(r)
                return (
                  <tr key={`${r.entryId ?? r.purchaseBillId ?? r.expenseId ?? 'r'}-${i}`} className={cn('border-b border-gray-50 align-top', r.kind === 'CREDIT_NOTE' && 'bg-red-50/30')}>
                    {columns.map(c => (
                      <td
                        key={c.key}
                        className={cn(
                          'px-3 py-2',
                          c.type === 'money' || c.type === 'qty' ? 'text-right tabular-nums whitespace-nowrap' : 'text-gray-700',
                          c.type === 'date' && 'whitespace-nowrap',
                          (c.key === 'challanNo' || c.key.endsWith('Bin') || c.key === 'partyTin' || c.key === 'invoiceNo') && 'font-mono',
                          c.type === 'money' && Number(r[c.key]) < 0 && 'text-red-600',
                        )}
                      >
                        {cellText(r[c.key], c.type)}
                      </td>
                    ))}
                    {hasLinks && (
                      <td className="px-2 py-2">
                        {href && (
                          <Link href={href} className="text-gray-400 hover:text-gray-700" aria-label="Open source document">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            {hasTotals && (
              <tfoot>
                <tr className="bg-gray-50 font-semibold text-gray-900">
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn('px-3 py-2', c.total && 'text-right tabular-nums whitespace-nowrap')}>
                      {c.total ? fmtAmount(totals?.[c.key] ?? 0) : (i === 0 ? 'Total' : '')}
                    </td>
                  ))}
                  {hasLinks && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  )
}
