'use client'

import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { addDays, format, parse } from 'date-fns'
import { CalendarClock, ChevronDown } from 'lucide-react'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import { Input } from '@/components/ui/Input'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { menuContent, menuItem } from './parts'
import { schedulePresets, validateSendAt } from './composeUtils'

export function ScheduleDialog({ open, onOpenChange, onSchedule }) {
  const [date, setDate] = useState(() => format(addDays(new Date(), 1), 'yyyy-MM-dd'))
  const [time, setTime] = useState('09:00')
  const [error, setError] = useState('')

  function submit() {
    const when = date && time ? parse(`${date} ${time}`, 'yyyy-MM-dd HH:mm', new Date()) : null
    const problem = validateSendAt(when)
    if (problem) { setError(problem); return }
    onOpenChange(false)
    onSchedule(when)
  }

  return (
    <Modal open={open} onOpenChange={(v) => { setError(''); onOpenChange(v) }} title="Schedule send" size="sm">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <DatePicker value={date} onChange={(v) => { setDate(v); setError('') }} clearable={false} placeholder="Date" />
        </div>
        <Input
          type="time"
          value={time}
          onChange={(e) => { setTime(e.target.value); setError('') }}
          className="w-32"
          aria-label="Time"
          invalid={!!error}
        />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={submit}>Schedule send</Button>
      </ModalFooter>
    </Modal>
  )
}

/** The chevron half of the split Send button. */
export default function ScheduleMenu({ disabled, onSchedule, className }) {
  const [customOpen, setCustomOpen] = useState(false)
  const [presets, setPresets] = useState(() => schedulePresets())

  return (
    <>
      <DropdownMenu.Root modal={false} onOpenChange={(v) => { if (v) setPresets(schedulePresets()) }}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label="Schedule send"
            className={cn(
              'inline-flex h-9 w-8 items-center justify-center rounded-r-lg border-l border-white/15 bg-primary text-primary-foreground shadow-xs outline-none transition-colors',
              'hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-primary/90',
              className
            )}
          >
            <ChevronDown className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="start" sideOffset={6} collisionPadding={8} className={cn(menuContent, 'w-64')}>
            <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-gray-500">Schedule send</DropdownMenu.Label>
            {presets.map((p) => (
              <DropdownMenu.Item key={p.id} onSelect={() => onSchedule(p.date)} className={menuItem}>
                <span className="flex-1">{p.label}</span>
                <span className="text-xs tabular-nums text-gray-400">{format(p.date, 'MMM d, h:mm a')}</span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100" />
            <DropdownMenu.Item
              // Let the menu finish closing before the dialog grabs focus.
              onSelect={() => setTimeout(() => setCustomOpen(true), 0)}
              className={menuItem}
            >
              <CalendarClock className="size-4 text-gray-400" />
              Pick date & time
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ScheduleDialog open={customOpen} onOpenChange={setCustomOpen} onSchedule={onSchedule} />
    </>
  )
}
