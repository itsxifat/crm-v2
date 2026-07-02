import { STATUS_META } from '@/lib/ventures'

// Client-portal project status pill. Uses the SAME status vocabulary the rest of
// the app uses (STATUS_META in lib/ventures) — the old client pages hard-coded a
// stale set (PLANNING/COMPLETED) that no longer matches the Project model, so
// most real statuses rendered as an unknown fallback and "active" filters missed
// them entirely. Plain function component (no hooks / no 'use client') so it can
// render in both server and client components.
const COLOR = {
  gray:   'bg-gray-100 text-gray-700',
  blue:   'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  yellow: 'bg-yellow-100 text-yellow-800',
  teal:   'bg-teal-100 text-teal-700',
  green:  'bg-green-100 text-green-700',
  orange: 'bg-orange-100 text-orange-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  red:    'bg-red-100 text-red-700',
}

export default function ProjectStatusBadge({ status, className = '' }) {
  const meta = STATUS_META[status] ?? { label: status ?? 'Unknown', color: 'gray' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${COLOR[meta.color] ?? COLOR.gray} ${className}`}>
      {meta.label}
    </span>
  )
}
