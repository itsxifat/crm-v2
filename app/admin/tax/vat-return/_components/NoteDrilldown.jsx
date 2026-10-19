'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { INPUT_NON_CREDIT_REASONS } from '@/lib/tax/catalog'
import { noteLabel } from '@/app/api/tax/vat-return/_lib/layout'
import { fmtAmount, fmtDay, fmtPeriod, round2, toNum } from '../_lib/format'

const CERT_LABELS = { NOT_REQUIRED: 'Not required', PENDING: 'Pending', RECEIVED: 'Received', ISSUED: 'Issued' }
const SUM_KEYS = ['base', 'sd', 'amount']

const party = (l) => (
  <div className="min-w-[140px]">
    <p className="text-gray-900">{l.partyName || '—'}</p>
    {l.partyBin && <p className="font-mono text-xs text-muted-foreground">BIN {l.partyBin}</p>}
  </div>
)

const doc = (l) => (
  <div className="whitespace-nowrap">
    <p className="font-mono text-xs text-gray-900">{l.documentNo || l.entryNo || '—'}</p>
    {l.entryNo && l.documentNo && <p className="font-mono text-xs text-muted-foreground">{l.entryNo}</p>}
  </div>
)

const money = (key) => ({ key, label: key === 'sd' ? 'SD' : key === 'base' ? 'Value' : 'VAT', align: 'right', render: l => fmtAmount(l[key]) })

function columnsFor(note) {
  const n = Number(note)
  if (note === '18a' || (n >= 10 && n <= 22)) {
    return [
      { key: 'doc', label: 'Challan / entry', render: doc },
      { key: 'date', label: 'Date', render: l => fmtDay(l.documentDate ?? l.date) },
      { key: 'party', label: 'Supplier', render: party },
      money('base'),
      money('amount'),
      {
        key: 'status', label: 'Status', render: l => (l.creditable === false
          ? <span className="text-amber-700">{INPUT_NON_CREDIT_REASONS[l.nonCreditReason] ?? 'Not creditable'}</span>
          : l.claimPeriod ? `Claimed ${fmtPeriod(l.claimPeriod)}` : (l.claimDeadline ? `Claim by ${fmtPeriod(l.claimDeadline)}` : '—')),
      },
    ]
  }
  if (n >= 1 && n <= 8) {
    return [
      { key: 'doc', label: 'Invoice (6.3)', render: doc },
      { key: 'date', label: 'Date', render: l => fmtDay(l.documentDate ?? l.date) },
      { key: 'party', label: 'Buyer', render: party },
      { key: 'code', label: 'Code', render: l => l.serviceCode || '—' },
      money('base'), money('sd'), money('amount'),
    ]
  }
  if (n === 24 || n === 29) {
    return [
      { key: 'party', label: n === 24 ? 'Supplier' : 'Customer', render: party },
      { key: 'doc', label: 'Invoice', render: doc },
      { key: 'date', label: 'Invoice date', render: l => fmtDay(l.documentDate ?? l.date) },
      { key: 'base', label: 'Value', align: 'right', render: l => fmtAmount(l.base) },
      { key: 'amount', label: 'VAT deducted', align: 'right', render: l => fmtAmount(l.amount) },
      {
        key: 'cert', label: 'Mushak-6.6', render: l => (
          <div className="whitespace-nowrap">
            <p>{l.certificate?.number || CERT_LABELS[l.certificate?.status] || '—'}</p>
            {l.certificate?.date && <p className="text-xs text-muted-foreground">{fmtDay(l.certificate.date)}</p>}
          </div>
        ),
      },
      {
        key: 'claim', label: n === 24 ? 'Deposit' : 'Claim', render: l => (n === 24
          ? (l.deposit?.status === 'VIA_RETURN' ? 'Via this return' : (l.deposit?.challanNo || l.deposit?.status || '—'))
          : (l.claimPeriod ? `Claimed ${fmtPeriod(l.claimPeriod)}` : 'This return')),
      },
    ]
  }
  if (n === 26 || n === 31) {
    return [
      { key: 'doc', label: 'Note no.', render: doc },
      { key: 'date', label: 'Date', render: l => fmtDay(l.documentDate ?? l.date) },
      { key: 'party', label: 'Party', render: party },
      money('base'), money('sd'), money('amount'),
    ]
  }
  if (n === 52) {
    return [
      { key: 'date', label: 'Date', render: l => fmtDay(l.date) },
      { key: 'side', label: 'Side', render: l => (l.balanceSide === 'PAYABLE' ? 'Payable brought forward' : 'Credit brought forward') },
      { key: 'ref', label: 'Reference', render: l => l.notes || l.documentNo || l.entryNo || '—' },
      { key: 'amount', label: 'Amount', align: 'right', render: l => fmtAmount(l.amount) },
    ]
  }
  if (n === 58 || n === 59) {
    return [
      { key: 'challan', label: 'Challan / token', render: l => <span className="font-mono text-xs">{l.challanNo || l.documentNo || '—'}</span> },
      { key: 'date', label: 'Date', render: l => fmtDay(l.date) },
      { key: 'bank', label: 'Bank / branch', render: l => [l.bank, l.branch].filter(Boolean).join(', ') || '—' },
      { key: 'code', label: 'Account code', render: l => <span className="font-mono text-xs">{l.accountCode || '—'}</span> },
      { key: 'amount', label: 'Amount', align: 'right', render: l => fmtAmount(l.amount) },
      { key: 'source', label: 'Source', render: l => (l.source === 'CHALLAN' ? 'Entered with the return' : (l.entryNo ? `Ledger ${l.entryNo}` : 'Ledger')) },
    ]
  }
  return [
    { key: 'date', label: 'Date', render: l => fmtDay(l.date) },
    { key: 'desc', label: 'Description', render: l => l.notes || noteLabel(l.note) },
    { key: 'doc', label: 'Reference', render: doc },
    { key: 'amount', label: 'Amount', align: 'right', render: l => fmtAmount(l.amount) },
  ]
}

function hrefFor(l) {
  if (l.invoiceId) return `/admin/invoices/${l.invoiceId}`
  return null
}

/** Modal listing the tax entries behind one Mushak-9.1 note. */
export default function NoteDrilldown({ note, result, onClose }) {
  const open = note !== null && note !== undefined
  const rows = open ? (result?.noteEntries?.[String(note)] ?? []) : []
  const cols = open ? columnsFor(note) : []
  const totals = Object.fromEntries(SUM_KEYS.map(k => [k, round2(rows.reduce((s, l) => s + toNum(l[k]), 0))]))
  const anyLink = rows.some(hrefFor)

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose() }}
      title={open ? `Note ${note} — ${noteLabel(note)}` : ''}
      description={open ? `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · ${result?.label ?? ''}` : undefined}
      size="full"
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No entries behind this note.</p>
      ) : (
        <div className="-mx-4 overflow-hidden border-y border-gray-100 sm:mx-0 sm:rounded-lg sm:border">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                {cols.map(c => (
                  <TableHead key={c.key} className={c.align === 'right' ? 'text-right' : undefined}>{c.label}</TableHead>
                ))}
                {anyLink && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l, i) => {
                const href = hrefFor(l)
                return (
                  <TableRow key={l.id ?? `${l.challanNo}-${i}`} className="align-top">
                    {cols.map(c => (
                      <TableCell key={c.key} className={c.align === 'right' ? 'whitespace-nowrap text-right tabular-nums text-gray-900' : undefined}>
                        {c.render(l)}
                      </TableCell>
                    ))}
                    {anyLink && (
                      <TableCell className="px-2">
                        {href && (
                          <Link href={href} className="inline-flex text-gray-400 hover:text-gray-900" aria-label="Open source document">
                            <ExternalLink className="size-4" />
                          </Link>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <tr className="font-semibold text-gray-900">
                {cols.map((c, i) => (
                  <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'whitespace-nowrap text-right tabular-nums' : ''}`}>
                    {SUM_KEYS.includes(c.key) ? fmtAmount(totals[c.key]) : (i === 0 ? 'Total' : '')}
                  </td>
                ))}
                {anyLink && <td />}
              </tr>
            </TableFooter>
          </Table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Amounts in Taka. To correct an entry, use the
        {' '}<Link href="/admin/tax/entries" className="font-medium text-gray-900 underline-offset-4 hover:underline">tax ledger</Link>
        {' '}or the source document.
      </p>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  )
}
