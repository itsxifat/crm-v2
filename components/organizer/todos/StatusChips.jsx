'use client'

import { cn } from '@/lib/utils'
import { TODO_STATUS, TODO_STATUS_KEYS } from '../constants'

/**
 * Summary chips (Open / In progress / Done / Overdue) that double as quick filters.
 *   counts   { OPEN, IN_PROGRESS, DONE, overdue } | null
 *   status   current status filter (string[]);  due  current due preset
 *   onSelect ({ status, due }) patch
 */
export default function StatusChips({ counts, status = [], due = '', onSelect, className }) {
  const chips = [
    ...TODO_STATUS_KEYS.map((k) => ({
      key: k,
      label: TODO_STATUS[k].label,
      dot: TODO_STATUS[k].dot,
      count: counts?.[k],
      active: status.length === 1 && status[0] === k && due !== 'overdue',
      patch: (active) => (active ? { status: [] } : { status: [k], due: due === 'overdue' ? '' : due }),
    })),
    {
      key: 'overdue',
      label: 'Overdue',
      dot: 'bg-red-500',
      count: counts?.overdue,
      danger: true,
      active: due === 'overdue',
      patch: (active) => (active ? { due: '' } : { due: 'overdue', status: status.includes('DONE') ? [] : status }),
    },
  ]

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={c.active}
          onClick={() => onSelect?.(c.patch(c.active))}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition-colors',
            c.active
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-200 bg-white text-gray-700 shadow-xs hover:bg-gray-50'
          )}
        >
          <span className={cn('size-1.5 rounded-full', c.dot)} />
          {c.label}
          <span
            className={cn(
              'min-w-[1.25rem] rounded-md px-1 text-center text-xs tabular-nums',
              c.active ? 'bg-white/15 text-white' : c.danger && c.count > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'
            )}
          >
            {c.count ?? '–'}
          </span>
        </button>
      ))}
    </div>
  )
}
