'use client'

import Badge from '@/components/ui/Badge'

export const TYPE_OPTIONS = [
  { value: 'INCREMENT',  label: 'Increment' },
  { value: 'PROMOTION',  label: 'Promotion' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'DECREASE',   label: 'Decrease' },
]

const STATUS = {
  PENDING:   { label: 'Waiting for approval', variant: 'warning' },
  APPROVED:  { label: 'Approved',             variant: 'success' },
  REJECTED:  { label: 'Not approved',         variant: 'danger'  },
  CANCELLED: { label: 'Cancelled',            variant: 'default' },
}

export function RevisionStatus({ r }) {
  if (r.status === 'APPROVED' && !r.inEffect) return <Badge variant="primary">Approved · from {r.effectiveLabel}</Badge>
  const s = STATUS[r.status] ?? { label: r.status, variant: 'default' }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** Current payroll month (Asia/Dhaka), 'YYYY-MM'. */
export function currentPeriod() {
  const d = new Date(Date.now() + 6 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function shiftPeriod(p, by) {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function periodLabel(p) {
  const [y, m] = String(p ?? '').split('-').map(Number)
  if (!y || !m) return p ?? ''
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** This month and the next twelve, for "starts from" pickers. */
export function monthOptions(count = 13) {
  const now = currentPeriod()
  return Array.from({ length: count }, (_, i) => {
    const p = shiftPeriod(now, i)
    return { value: p, label: `${periodLabel(p)}${i === 0 ? ' (this month)' : ''}` }
  })
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * New salary from a base and what was typed.
 *   mode 'salary'  → the value itself
 *   mode 'percent' → base × (1 ± value%), rounded to whole taka
 *   mode 'amount'  → base ± value
 */
export function computeNewSalary(base, mode, value, type) {
  const v = Number(value)
  if (value === '' || value == null || !Number.isFinite(v)) return null
  const sign = type === 'DECREASE' ? -1 : 1
  if (mode === 'salary') return round2(v)
  if (mode === 'percent') return Math.round((Number(base) || 0) * (1 + (sign * Math.abs(v)) / 100))
  return round2((Number(base) || 0) + sign * Math.abs(v))
}

export function changeText(from, to) {
  const diff = round2((Number(to) || 0) - (Number(from) || 0))
  const pct = Number(from) > 0 ? round2((diff / Number(from)) * 100) : null
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : ''
  const abs = Math.abs(diff).toLocaleString('en-BD', { maximumFractionDigits: 2 })
  return `${sign}৳ ${abs}${pct !== null ? ` (${sign}${Math.abs(pct)}%)` : ''}`
}
