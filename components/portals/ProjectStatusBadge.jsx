import { STATUS_META } from '@/lib/ventures'
import { cn } from '@/lib/utils'

// Client-portal project status pill. Uses the SAME status vocabulary the rest of
// the app uses (STATUS_META in lib/ventures) — the old client pages hard-coded a
// stale set (PLANNING/COMPLETED) that no longer matches the Project model, so
// most real statuses rendered as an unknown fallback and "active" filters missed
// them entirely. Plain function component (no hooks / no 'use client') so it can
// render in both server and client components. Styling mirrors components/ui/Badge.
const COLOR = {
  gray:   'bg-gray-100 text-gray-700 ring-gray-500/10',
  blue:   'bg-blue-50 text-blue-700 ring-blue-600/15',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  yellow: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  teal:   'bg-teal-50 text-teal-700 ring-teal-600/15',
  green:  'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/15',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/15',
  red:    'bg-red-50 text-red-700 ring-red-600/15',
}

export default function ProjectStatusBadge({ status, className = '' }) {
  const meta = STATUS_META[status] ?? { label: status ?? 'Unknown', color: 'gray' }
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        COLOR[meta.color] ?? COLOR.gray,
        className
      )}
    >
      {meta.label}
    </span>
  )
}
