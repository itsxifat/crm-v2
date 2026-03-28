'use client'

import { cn } from '@/lib/utils'

const variantStyles = {
  default:  'bg-gray-100 text-gray-700',
  primary:  'bg-blue-100 text-blue-700',
  success:  'bg-green-100 text-green-700',
  warning:  'bg-yellow-100 text-yellow-700',
  danger:   'bg-red-100 text-red-700',
  purple:   'bg-purple-100 text-purple-700',
  orange:   'bg-orange-100 text-orange-700',
  pink:     'bg-pink-100 text-pink-700',
  teal:     'bg-teal-100 text-teal-700',
  indigo:   'bg-indigo-100 text-indigo-700',
}

const STATUS_MAP = {
  // Lead
  NEW:            'primary',
  CONTACTED:      'purple',
  PROPOSAL_SENT:  'warning',
  NEGOTIATION:    'orange',
  WON:            'success',
  LOST:           'danger',
  // Project
  PLANNING:       'primary',
  IN_PROGRESS:    'warning',
  ON_HOLD:        'default',
  COMPLETED:      'success',
  CANCELLED:      'danger',
  // Task
  TODO:           'default',
  IN_REVIEW:      'purple',
  // Invoice
  DRAFT:          'default',
  SENT:           'primary',
  PARTIALLY_PAID: 'warning',
  PAID:           'success',
  OVERDUE:        'danger',
  // Agreement
  SIGNED:         'success',
  EXPIRED:        'default',
  // Leave / Withdrawal
  PENDING:        'warning',
  APPROVED:       'success',
  REJECTED:       'danger',
  FAILED:         'danger',
  REFUNDED:       'purple',
  // Attendance
  PRESENT:        'success',
  ABSENT:         'danger',
  LATE:           'warning',
  HALF_DAY:       'orange',
}

const LABEL_MAP = {
  NEW:            'New',
  CONTACTED:      'Contacted',
  PROPOSAL_SENT:  'Proposal Sent',
  NEGOTIATION:    'Negotiation',
  WON:            'Won',
  LOST:           'Lost',
  PLANNING:       'Planning',
  IN_PROGRESS:    'In Progress',
  ON_HOLD:        'On Hold',
  COMPLETED:      'Completed',
  CANCELLED:      'Cancelled',
  TODO:           'To Do',
  IN_REVIEW:      'In Review',
  DRAFT:          'Draft',
  SENT:           'Sent',
  PARTIALLY_PAID: 'Partially Paid',
  PAID:           'Paid',
  OVERDUE:        'Overdue',
  SIGNED:         'Signed',
  EXPIRED:        'Expired',
  PENDING:        'Pending',
  APPROVED:       'Approved',
  REJECTED:       'Rejected',
  FAILED:         'Failed',
  REFUNDED:       'Refunded',
  PRESENT:        'Present',
  ABSENT:         'Absent',
  LATE:           'Late',
  HALF_DAY:       'Half Day',
}

export default function Badge({ status, variant, children, className, size = 'sm' }) {
  const resolvedVariant = variant ?? STATUS_MAP[status] ?? 'default'
  const label = children ?? LABEL_MAP[status] ?? status?.replace(/_/g, ' ') ?? ''

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variantStyles[resolvedVariant],
        size === 'sm' && 'px-2.5 py-0.5 text-xs',
        size === 'md' && 'px-3 py-1 text-sm',
        size === 'lg' && 'px-4 py-1.5 text-sm',
        className
      )}
    >
      {label}
    </span>
  )
}
