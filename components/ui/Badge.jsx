'use client'

import { cn } from '@/lib/utils'

const variantStyles = {
  default:  'bg-gray-100 text-gray-700 ring-gray-500/10',
  primary:  'bg-blue-50 text-blue-700 ring-blue-600/15',
  success:  'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  warning:  'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger:   'bg-red-50 text-red-700 ring-red-600/15',
  purple:   'bg-violet-50 text-violet-700 ring-violet-600/15',
  orange:   'bg-orange-50 text-orange-700 ring-orange-600/15',
  pink:     'bg-pink-50 text-pink-700 ring-pink-600/15',
  teal:     'bg-teal-50 text-teal-700 ring-teal-600/15',
  indigo:   'bg-indigo-50 text-indigo-700 ring-indigo-600/15',
  outline:  'bg-white text-gray-700 ring-gray-200',
}

const dotStyles = {
  default: 'bg-gray-400',  primary: 'bg-blue-500',   success: 'bg-emerald-500', warning: 'bg-amber-500',
  danger:  'bg-red-500',   purple:  'bg-violet-500', orange:  'bg-orange-500',  pink:    'bg-pink-500',
  teal:    'bg-teal-500',  indigo:  'bg-indigo-500', outline: 'bg-gray-400',
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
  PROPOSAL_SENT:  'Proposal sent',
  NEGOTIATION:    'Negotiation',
  WON:            'Won',
  LOST:           'Lost',
  PLANNING:       'Planning',
  IN_PROGRESS:    'In progress',
  ON_HOLD:        'On hold',
  COMPLETED:      'Completed',
  CANCELLED:      'Cancelled',
  TODO:           'To do',
  IN_REVIEW:      'In review',
  DRAFT:          'Draft',
  SENT:           'Sent',
  PARTIALLY_PAID: 'Partially paid',
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
  HALF_DAY:       'Half day',
}

export default function Badge({ status, variant, children, className, size = 'sm', dot = false }) {
  const resolvedVariant = variant ?? STATUS_MAP[status] ?? 'default'
  const label = children ?? LABEL_MAP[status] ?? status?.replace(/_/g, ' ') ?? ''

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset',
        variantStyles[resolvedVariant] ?? variantStyles.default,
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-2.5 py-0.5 text-[13px]',
        size === 'lg' && 'px-3 py-1 text-sm',
        className
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', dotStyles[resolvedVariant] ?? dotStyles.default)} />}
      {label}
    </span>
  )
}
