'use client'

import { useState, useRef, useEffect } from 'react'
import {
  format, parse, isValid,
  startOfMonth, endOfMonth,
  startOfWeek, endOfWeek,
  addDays, addMonths, subMonths,
  isSameDay, isSameMonth, isToday,
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createPortal } from 'react-dom'

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function buildCalendarDays(month) {
  const start = startOfWeek(startOfMonth(month))
  const end   = endOfWeek(endOfMonth(month))
  const days  = []
  let cur = start
  while (cur <= end) { days.push(cur); cur = addDays(cur, 1) }
  return days
}

/**
 * Custom DatePicker — consistent across the entire app.
 *
 * Props:
 *   value       string  (YYYY-MM-DD) | null
 *   onChange    (val: string | null) => void
 *   placeholder string
 *   disabled    boolean
 *   className   string   — applied to the trigger button
 *   size        'sm' | 'md'
 *   clearable   boolean  (show × to clear, default true)
 */
export default function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date…',
  disabled = false,
  className,
  size = 'md',
  clearable = true,
}) {
  const [open,    setOpen]    = useState(false)
  const [month,   setMonth]   = useState(() => {
    if (value) { const d = parse(value, 'yyyy-MM-dd', new Date()); if (isValid(d)) return d }
    return new Date()
  })
  const [pos,     setPos]     = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  // Sync month when value changes externally
  useEffect(() => {
    if (value) {
      const d = parse(value, 'yyyy-MM-dd', new Date())
      if (isValid(d)) setMonth(d)
    }
  }, [value])

  // Position popover below trigger
  function openCalendar() {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const scrollY = window.scrollY
    const scrollX = window.scrollX
    setPos({ top: rect.bottom + scrollY + 5, left: rect.left + scrollX })
    setOpen(true)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (popoverRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function selectDay(day) {
    onChange?.(format(day, 'yyyy-MM-dd'))
    setOpen(false)
  }

  function clear(e) {
    e.stopPropagation()
    onChange?.(null)
  }

  const parsed   = value ? parse(value, 'yyyy-MM-dd', new Date()) : null
  const hasValue = parsed && isValid(parsed)
  const days     = buildCalendarDays(month)

  const py   = size === 'sm' ? 'py-1.5' : 'py-2'
  const text = size === 'sm' ? 'text-xs'  : 'text-sm'

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={openCalendar}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 w-full px-3 border rounded-lg bg-white transition-all duration-150',
        'border-gray-200 hover:border-gray-300 cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50',
        py, text,
        className,
      )}
    >
      <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span className={cn('flex-1 text-left', hasValue ? 'text-gray-800' : 'text-gray-400')}>
        {hasValue ? format(parsed, 'dd MMM yyyy') : placeholder}
      </span>
      {hasValue && clearable && (
        <X
          className="w-3.5 h-3.5 text-gray-300 hover:text-gray-500 shrink-0"
          onClick={clear}
        />
      )}
    </button>
  )

  const calendar = open && typeof document !== 'undefined' && createPortal(
    <div
      ref={popoverRef}
      style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 9999 }}
      className={cn(
        'w-72 bg-white rounded-2xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.10)] p-4',
        'animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150',
      )}
    >
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setMonth(m => subMonths(m, 1))}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-gray-900">
          {format(month, 'MMMM yyyy')}
        </span>
        <button
          type="button"
          onClick={() => setMonth(m => addMonths(m, 1))}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day, i) => {
          const inMonth   = isSameMonth(day, month)
          const selected  = hasValue && isSameDay(day, parsed)
          const today     = isToday(day)

          return (
            <button
              key={i}
              type="button"
              onClick={() => selectDay(day)}
              className={cn(
                'h-8 w-full rounded-lg text-xs font-medium transition-all duration-100',
                !inMonth && 'text-gray-300',
                inMonth && !selected && !today && 'text-gray-700 hover:bg-blue-50 hover:text-blue-700',
                today && !selected && 'text-blue-600 ring-1 ring-blue-300 ring-inset',
                selected && 'bg-blue-600 text-white shadow-sm',
              )}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <button
          type="button"
          onClick={() => { selectDay(new Date()) }}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          Today
        </button>
        {clearable && hasValue && (
          <button
            type="button"
            onClick={() => { onChange?.(null); setOpen(false) }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>
    </div>,
    document.body,
  )

  return (
    <>
      {trigger}
      {calendar}
    </>
  )
}
