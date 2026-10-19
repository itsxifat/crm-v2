'use client'

import Link from 'next/link'
import { BookOpen, ExternalLink, Info } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
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
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-gray-900">
            <span>{reg.form ? `${reg.form} — ` : ''}{reg.title}</span>
            <span className="text-[13px] font-normal text-muted-foreground">{reg.label}</span>
            {reg.hint && (
              <span title={reg.hint} aria-label={reg.hint} className="inline-flex cursor-help text-gray-400 hover:text-gray-600">
                <Info className="size-4" />
              </span>
            )}
          </p>
          {reg.rule && <p className="mt-0.5 text-xs text-muted-foreground">{reg.rule}</p>}
        </div>
        <Summary reg={reg} />
      </div>

      {reg.truncated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
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
  sales:     'No tax invoices, credit or debit notes in this period.',
  purchases: 'No purchases in this period.',
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
        <div key={label} className="min-w-[120px] rounded-lg border border-gray-200/80 bg-white px-3 py-2 shadow-xs">
          <p className="text-xs text-muted-foreground">{label}</p>
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

const isNum = (c) => c.type === 'money' || c.type === 'qty'

function RegisterTable({ title, columns, rows, totals, numbered, emptyText }) {
  const hasLinks = rows.some(linkFor)
  const hasTotals = rows.length > 0 && columns.some(c => c.total)
  return (
    <Card as="section" className="overflow-hidden">
      {title && (
        <CardHeader className="border-b border-gray-100 pb-3">
          <CardTitle as="h2">{title}</CardTitle>
        </CardHeader>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No entries" description={emptyText} className="py-12" />
      ) : (
        <Table className="text-xs">
          <TableHeader className={numbered ? '[&_tr:first-child]:border-b-0' : undefined}>
            <TableRow>
              {columns.map(c => (
                <TableHead key={c.key} className={cn('h-auto whitespace-normal px-3 pb-1.5 pt-3 align-bottom', isNum(c) ? 'text-right' : 'text-left', c.type === 'text' && 'min-w-[120px]')}>
                  {c.label}
                </TableHead>
              ))}
              {hasLinks && <TableHead className="w-8 px-2" />}
            </TableRow>
            {numbered && (
              <TableRow>
                {columns.map(c => (
                  <TableHead key={c.key} className={cn('h-auto px-3 pb-1.5 pt-0 text-[11px] font-normal tabular-nums text-gray-400', isNum(c) ? 'text-right' : 'text-left')}>{c.no ?? ''}</TableHead>
                ))}
                {hasLinks && <TableHead className="h-auto px-2" />}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const href = linkFor(r)
              return (
                <TableRow key={`${r.entryId ?? r.purchaseBillId ?? r.expenseId ?? 'r'}-${i}`} className={cn('align-top', r.kind === 'CREDIT_NOTE' && 'bg-red-50/30')}>
                  {columns.map(c => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        'px-3 py-2',
                        isNum(c) ? 'whitespace-nowrap text-right tabular-nums text-gray-900' : 'text-gray-700',
                        c.type === 'date' && 'whitespace-nowrap',
                        (c.key === 'challanNo' || c.key.endsWith('Bin') || c.key === 'partyTin' || c.key === 'invoiceNo') && 'font-mono',
                        c.type === 'money' && Number(r[c.key]) < 0 && 'text-red-600',
                      )}
                    >
                      {cellText(r[c.key], c.type)}
                    </TableCell>
                  ))}
                  {hasLinks && (
                    <TableCell className="px-2 py-2">
                      {href && (
                        <Link href={href} className="inline-flex text-gray-400 hover:text-gray-900" aria-label="Open source document">
                          <ExternalLink className="size-3.5" />
                        </Link>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
          {hasTotals && (
            <TableFooter>
              <tr className="font-semibold text-gray-900">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn('px-3 py-2', c.total && 'whitespace-nowrap text-right tabular-nums')}>
                    {c.total ? fmtAmount(totals?.[c.key] ?? 0) : (i === 0 ? 'Total' : '')}
                  </td>
                ))}
                {hasLinks && <td />}
              </tr>
            </TableFooter>
          )}
        </Table>
      )}
    </Card>
  )
}
