'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { INPUT_NON_CREDIT_REASONS } from '@/lib/tax/catalog'
import { noteLabel } from '@/app/api/tax/vat-return/_lib/layout'
import { fmtAmount, fmtDay, fmtPeriod, round2, toNum, btnGhost } from '../_lib/format'

const CERT_LABELS = { NOT_REQUIRED: 'Not required', PENDING: 'Pending', RECEIVED: 'Received', ISSUED: 'Issued' }
const SUM_KEYS = ['base', 'sd', 'amount']

const party = (l) => (
  <div className="min-w-[140px]">
    <p className="text-gray-800">{l.partyName || '—'}</p>
    {l.partyBin && <p className="text-[11px] text-gray-500 font-mono">BIN {l.partyBin}</p>}
  </div>
)

const doc = (l) => (
  <div className="whitespace-nowrap">
    <p className="font-mono text-xs text-gray-800">{l.documentNo || l.entryNo || '—'}</p>
    {l.entryNo && l.documentNo && <p className="text-[11px] text-gray-400 font-mono">{l.entryNo}</p>}
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
            {l.certificate?.date && <p className="text-[11px] text-gray-500">{fmtDay(l.certificate.date)}</p>}
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
        <p className="text-sm text-gray-500 py-6 text-center">No entries behind this note.</p>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                {cols.map(c => (
                  <th key={c.key} className={`px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                ))}
                {anyLink && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => {
                const href = hrefFor(l)
                return (
                  <tr key={l.id ?? `${l.challanNo}-${i}`} className="border-b border-gray-50 align-top">
                    {cols.map(c => (
                      <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : 'text-gray-700'}`}>
                        {c.render(l)}
                      </td>
                    ))}
                    {anyLink && (
                      <td className="px-2 py-2">
                        {href && (
                          <Link href={href} className="text-gray-400 hover:text-gray-700" aria-label="Open source document">
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                {cols.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                    {SUM_KEYS.includes(c.key) ? fmtAmount(totals[c.key]) : (i === 0 ? 'Total' : '')}
                  </td>
                ))}
                {anyLink && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-3">
        Amounts are in Taka. To correct an entry, open the tax ledger
        {' '}<Link href="/admin/tax/entries" className="text-blue-600 hover:underline">Tax ledger</Link>
        {' '}or the source invoice / bill.
      </p>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} className={btnGhost}>Close</button>
      </ModalFooter>
    </Modal>
  )
}
