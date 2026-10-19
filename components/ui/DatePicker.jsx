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


const DAYS    = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const POPUP_W = 288 // w-72
const POPUP_H = 330 // approximate

function buildCalendarDays(month) {
  const start = startOfWeek(startOfMonth(month))
  const end   = endOfWeek(endOfMonth(month))
  const days  = []
  let cur = start
  while (cur <= end) { days.push(cur); cur = addDays(cur, 1) }
  return days
}

/**
 * DatePicker — consistent across the entire app.
 *
 * Props:
 *   value       string (YYYY-MM-DD) | null
 *   onChange    (val: string | null) => void
 *   placeholder string
 *   disabled    boolean
 *   className   string  — applied to the trigger button
 *   size        'sm' | 'md'
 *   clearable   boolean (default true)
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
  const [open,   setOpen]   = useState(false)
  const [month,  setMonth]  = useState(() => {
    if (value) { const d = parse(value, 'yyyy-MM-dd', new Date()); if (isValid(d)) return d }
    return new Date()
  })
  // pos.mobile = true → bottom-sheet mode; false → anchored popup
  const [pos, setPos] = useState({ top: 0, left: 0, mobile: false })

  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  // Sync displayed month when value changes externally
  useEffect(() => {
    if (value) {
      const d = parse(value, 'yyyy-MM-dd', new Date())
      if (isValid(d)) setMonth(d)
    }
  }, [value])

  function openCalendar() {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    const vw = window.innerWidth
    const vh = window.innerHeight

    // Mobile: show as bottom sheet
    if (vw < 640) {
      setPos({ top: 0, left: 0, mobile: true })
      setOpen(true)
      return
    }

    // Desktop: use fixed positioning (rect values are viewport-relative; no scroll offset needed)
    let top  = rect.bottom + 6
    let left = rect.left

    // Flip upward if not enough space below
    if (top + POPUP_H > vh - 8) {
      top = rect.top - POPUP_H - 6
    }
    if (top < 8) top = 8

    // Clamp horizontally
    if (left + POPUP_W > vw - 8) left = vw - POPUP_W - 8
    if (left < 8) left = 8

    setPos({ top, left, mobile: false })
    setOpen(true)
  }

  // Close on outside click / touch
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (
        popoverRef.current?.contains(e.target) ||
        triggerRef.current?.contains(e.target)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('touchstart', handle, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('touchstart', handle)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handle(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open])

  function selectDay(day) {
    onChange?.(format(day, 'yyyy-MM-dd'))
    setOpen(false)
  }

  function clearDate(e) {
    e.stopPropagation()
    onChange?.(null)
  }

  const parsed   = value ? parse(value, 'yyyy-MM-dd', new Date()) : null
  const hasValue = parsed && isValid(parsed)
  const days     = buildCalendarDays(month)
  const textSize = size === 'sm' ? 'text-[13px]' : 'text-sm'

  // ── Calendar body (shared between mobile/desktop) ──────────────────────────
  const calendarBody = (
    <>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setMonth(m => subMonths(m, 1))}
          className="inline-flex size-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold text-gray-900">
          {format(month, 'MMMM yyyy')}
        </span>
        <button
          type="button"
          onClick={() => setMonth(m => addMonths(m, 1))}
          className="inline-flex size-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[11px] font-medium text-gray-400 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day, i) => {
          const inMonth  = isSameMonth(day, month)
          const selected = hasValue && isSameDay(day, parsed)
          const today    = isToday(day)
          return (
            <button
              key={i}
              type="button"
              onClick={() => selectDay(day)}
              className={cn(
                'h-9 w-full rounded-md text-[13px] font-normal tabular-nums transition-colors duration-100',
                !inMonth && 'text-gray-300 hover:bg-gray-50',
                inMonth && !selected && !today && 'text-gray-800 hover:bg-gray-100',
                today && !selected && 'bg-gray-100 font-semibold text-gray-900',
                selected && 'bg-gray-900 font-medium text-white shadow-sm',
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
          onClick={() => selectDay(new Date())}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-900 hover:bg-gray-100"
        >
          Today
        </button>
        {clearable && hasValue && (
          <button
            type="button"
            onClick={() => { onChange?.(null); setOpen(false) }}
            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            Clear
          </button>
        )}
      </div>
    </>
  )

  // ── Portal popup ───────────────────────────────────────────────────────────
  // Rendered into <body>; an open Radix dialog sets `pointer-events: none` on
  // body, so every popup layer must opt back in or clicks fall through to the
  // dialog overlay.
  const popup = open && typeof document !== 'undefined' && createPortal(
    pos.mobile ? (
      /* Mobile: backdrop + bottom sheet */
      <>
        <div
          className="pointer-events-auto fixed inset-0 z-[9998] bg-black/40"
          onMouseDown={() => setOpen(false)}
          onTouchStart={() => setOpen(false)}
        />
        <div
          ref={popoverRef}
          data-datepicker-popup=""
          className="pointer-events-auto fixed bottom-0 left-0 right-0 z-[9999] bg-white rounded-t-2xl p-4 pb-8 shadow-2xl animate-in slide-in-from-bottom duration-200"
        >
          {/* Handle bar */}
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
          {calendarBody}
        </div>
      </>
    ) : (
      /* Desktop: fixed anchored popup */
      <div
        ref={popoverRef}
        data-datepicker-popup=""
        style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: POPUP_W }}
        className="pointer-events-auto rounded-xl border border-gray-200/80 bg-white p-3 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
      >
        {calendarBody}
      </div>
    ),
    document.body,
  )

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openCalendar}
        disabled={disabled}
        className={cn(
          'flex items-center gap-2 w-full px-3 rounded-lg border border-input bg-white shadow-xs transition-[color,box-shadow,border-color]',
          'hover:border-gray-300 cursor-pointer',
          'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
          'disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-50',
          size === 'sm' ? 'h-8' : 'h-9', textSize,
          className,
        )}
      >
        <CalendarDays className="size-4 text-gray-400 shrink-0" />
        <span className={cn('flex-1 text-left truncate', hasValue ? 'text-gray-900' : 'text-gray-400')}>
          {hasValue ? format(parsed, 'dd MMM yyyy') : placeholder}
        </span>
        {hasValue && clearable && (
          <X
            className="w-3.5 h-3.5 text-gray-300 hover:text-gray-500 shrink-0"
            onClick={clearDate}
          />
        )}
      </button>

      {popup}
    </>
  )
}
