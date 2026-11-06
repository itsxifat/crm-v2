'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarRange } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import { fromYMD } from '../constants'
import Popover from './Popover'

/** 'YYYY-MM-DD' pair → '3 Nov – 9 Nov' / 'From 3 Nov' / 'Until 9 Nov'. */
export function formatRange(from, to) {
  const f = (s) => {
    const d = fromYMD(s)
    return d ? format(d, d.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy') : ''
  }
  if (from && to) return from === to ? f(from) : `${f(from)} – ${f(to)}`
  if (from) return `From ${f(from)}`
  if (to) return `Until ${f(to)}`
  return ''
}

/** Facet button + popover with two date pickers. value = { from, to } ('YYYY-MM-DD' | ''). */
export default function DateRangeFilter({ label = 'Date range', icon: Icon = CalendarRange, from, to, onChange, className }) {
  const [open, setOpen] = useState(false)
  const active = !!(from || to)

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={cn(
        buttonVariants({ variant: 'outline', size: 'sm' }),
        'max-w-full font-normal',
        !active && 'border-dashed text-gray-600',
        open && 'bg-accent',
        className
      )}
    >
      <Icon className="text-gray-500" />
      <span className={cn(active && 'font-medium text-gray-900')}>{label}</span>
      {active && (
        <>
          <span className="h-4 w-px bg-gray-200" />
          <span className="max-w-[160px] truncate rounded-md bg-gray-100 px-1.5 text-xs font-medium text-gray-700">{formatRange(from, to)}</span>
        </>
      )}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} width={280} title={label}>
      <div className="space-y-3 p-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">From</p>
          <DatePicker
            size="sm"
            value={from || null}
            placeholder="Any"
            onChange={(v) => {
              const next = v ?? ''
              onChange?.({ from: next, to: to && next && to < next ? next : to })
            }}
          />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">To</p>
          <DatePicker
            size="sm"
            value={to || null}
            placeholder="Any"
            onChange={(v) => {
              const next = v ?? ''
              onChange?.({ from: from && next && from > next ? next : from, to: next })
            }}
          />
        </div>
      </div>
      {active && (
        <div className="border-t border-gray-100 p-1">
          <button
            type="button"
            onClick={() => { onChange?.({ from: '', to: '' }); setOpen(false) }}
            className="w-full rounded-md px-2 py-1.5 text-center text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Clear
          </button>
        </div>
      )}
    </Popover>
  )
}
