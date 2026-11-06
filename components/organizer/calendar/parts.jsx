'use client'

import { forwardRef } from 'react'
import { Check, Minus, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { colorClasses } from '../constants'
import { fmtTimeCompact } from './layout'

/** shadcn-style toggle. */
export const Switch = forwardRef(function Switch({ checked = false, onChange, disabled, size = 'default', className, ...props }, ref) {
  const sm = size === 'sm'
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full shadow-xs outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        sm ? 'h-[18px] w-8' : 'h-5 w-9',
        checked ? 'bg-gray-900' : 'bg-gray-200',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-sm transition-transform duration-150',
          sm ? 'size-3.5' : 'size-4',
          checked ? (sm ? 'translate-x-4' : 'translate-x-[18px]') : 'translate-x-0.5',
        )}
      />
    </button>
  )
})

/** Square checkbox filled with a palette colour when checked (Google-calendar style). */
export function CalCheckbox({ checked, indeterminate, color = 'zinc', onChange, label, className }) {
  const c = colorClasses(color)
  const on = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : !!checked}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked) }}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-white outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        on ? cn(c.dot, 'border-transparent') : 'border-gray-300 bg-white hover:border-gray-400',
        className,
      )}
    >
      {indeterminate ? <Minus className="size-3" strokeWidth={3} /> : checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </button>
  )
}

/** Small square "check" used for to-dos on the calendar. */
export function TodoBox({ done, color, className }) {
  const c = colorClasses(color)
  return (
    <span
      className={cn(
        'flex size-3 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]',
        done ? cn(c.dot, 'border-transparent text-white') : cn(c.border, 'bg-white'),
        className,
      )}
    >
      {done && <Check className="size-2.5" strokeWidth={3.5} />}
    </span>
  )
}

/**
 * One calendar item inside a day row (month cell, all-day row, "+N more" list).
 *   variant 'auto'  → all-day/multi-day bars get a soft fill; short timed events get dot + time; to-dos a check.
 *   compact         → narrow cells (phones): smaller text, no time.
 * Position it with className/style from the parent.
 */
export function ItemChip({ item, compact = false, contStart = false, contEnd = false, showTime = true, active = false, onClick, className, style }) {
  const handle = (e) => {
    e.stopPropagation()
    onClick?.(item, e.currentTarget.getBoundingClientRect())
  }
  const text = compact ? 'text-[10px]' : 'text-xs'

  if (item.kind === 'todo') {
    const done = item.status === 'DONE'
    return (
      <button
        type="button"
        onClick={handle}
        style={style}
        title={item.title}
        className={cn(
          'flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[5px] px-1.5 text-left text-gray-700 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-ring/50',
          text,
          active && 'bg-gray-100',
          className,
        )}
      >
        <TodoBox done={done} color={item.list?.color} />
        <span className={cn('truncate', done && 'text-gray-400 line-through')}>{item.title}</span>
      </button>
    )
  }

  const c = colorClasses(item.color)

  if (item._allDayLane || compact) {
    return (
      <button
        type="button"
        onClick={handle}
        style={style}
        title={item.title}
        className={cn(
          'flex items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 text-left font-medium outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/50',
          text,
          c.soft, c.softHover, c.text,
          contStart ? 'rounded-l-none pl-2' : cn('rounded-l-[5px] border-l-[3px]', c.border),
          contEnd ? 'rounded-r-none' : 'rounded-r-[5px]',
          active && 'shadow-md ring-1 ring-black/10',
          className,
        )}
      >
        {!item.allDay && !compact && showTime && !contStart && (
          <span className="shrink-0 font-normal tabular-nums opacity-70">{fmtTimeCompact(item._start)}</span>
        )}
        <span className="truncate">{item.title}</span>
        {item.isRecurring && !compact && <Repeat className="ml-auto size-3 shrink-0 opacity-50" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handle}
      style={style}
      title={item.title}
      className={cn(
        'flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[5px] px-1.5 text-left outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-ring/50',
        text,
        active && 'bg-gray-100',
        className,
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full', c.dot)} />
      {showTime && <span className="shrink-0 tabular-nums text-gray-500">{fmtTimeCompact(item._start)}</span>}
      <span className="truncate font-medium text-gray-800">{item.title}</span>
    </button>
  )
}
