'use client'

import { cn } from '@/lib/utils'
import {
  tone, ENTRY_TYPE_TONE, entryTypeLabel, CERT_STATUS_META, DEPOSIT_STATUS_META, daysLeftText, daysLeftTone, tk,
} from './taxUi'

/** Generic pill with an optional dot. */
export function TaxPill({ label, color = 'gray', dot = true, className, title }) {
  const t = tone(color)
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap', t.badge, className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', t.dot)} />}
      {label}
    </span>
  )
}

/** TaxEntry type (Output VAT, TDS deducted from payees, …). */
export function EntryTypeBadge({ type, className }) {
  return <TaxPill label={entryTypeLabel(type)} color={ENTRY_TYPE_TONE[type] ?? 'gray'} dot={false} className={className} />
}

/** Certificate status. */
export function CertificateBadge({ certificate, className }) {
  const status = certificate?.status ?? 'NOT_REQUIRED'
  const m = CERT_STATUS_META[status] ?? CERT_STATUS_META.NOT_REQUIRED
  return <TaxPill label={m.label} color={m.tone} className={className} title={certificate?.number ? `No. ${certificate.number}` : undefined} />
}

/** Deposit status of a withheld amount ("Part-deposited" while challans have paid only some of it). */
export function DepositBadge({ deposit, className }) {
  const status = deposit?.status ?? 'NOT_REQUIRED'
  const challans = [...new Set((deposit?.allocations ?? []).map(a => a?.challanNo).filter(Boolean))]
  const paid = Number(deposit?.paidAmount) || 0
  if (status === 'PENDING' && paid > 0) {
    return <TaxPill label={`Part-deposited ${tk(paid)}`} color="blue" className={className} title={challans.length ? `Challan ${challans.join(', ')}` : undefined} />
  }
  const m = DEPOSIT_STATUS_META[status] ?? DEPOSIT_STATUS_META.NOT_REQUIRED
  const title = challans.length > 1 ? `Challans ${challans.join(', ')}` : deposit?.challanNo ? `Challan ${deposit.challanNo}` : undefined
  return <TaxPill label={m.label} color={m.tone} className={className} title={title} />
}

/** 'Due today' / '3 days left' / '5 days overdue' / 'Done'. */
export function DaysLeftBadge({ daysLeft, done = false, doneLabel = 'Done', className }) {
  if (done) return <TaxPill label={doneLabel} color="green" className={className} />
  if (daysLeft === null || daysLeft === undefined) return null
  return <TaxPill label={daysLeftText(daysLeft)} color={daysLeftTone(daysLeft)} className={className} />
}

/** ACTIVE / VOID. */
export function EntryStatusBadge({ status, className }) {
  if (status === 'VOID') return <TaxPill label="Void" color="red" className={className} />
  return <TaxPill label="Active" color="green" className={className} />
}
