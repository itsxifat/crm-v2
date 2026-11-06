'use client'

import { useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, ChevronRight, ListChecks, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { colorClasses } from '../constants'
import { CalCheckbox, Switch } from './parts'

const menuContent = 'z-[70] min-w-[180px] rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100'
const menuItem = 'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none transition-colors data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900'

function CalendarRow({ cal, visible, onToggle, canManage, onEdit, onDelete, indent }) {
  return (
    <div
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-md pr-1 transition-colors hover:bg-gray-50',
        indent ? 'pl-[26px]' : 'pl-1.5',
      )}
    >
      <CalCheckbox checked={visible} color={cal.color} onChange={(v) => onToggle(cal.id, v)} label={cal.name} />
      <button
        type="button"
        onClick={() => onToggle(cal.id, !visible)}
        className="min-w-0 flex-1 truncate text-left text-sm text-gray-700"
        title={cal.name}
      >
        {cal.name}
      </button>
      {canManage && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`${cal.name} options`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-gray-400 outline-none transition hover:bg-gray-200/70 hover:text-gray-900 data-[state=open]:bg-gray-200/70 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={menuContent} onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenu.Item className={menuItem} onSelect={() => onEdit(cal)}>
                <Pencil className="size-4 text-gray-500" /> Edit
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={cn(menuItem, 'text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700')}
                onSelect={() => onDelete(cal)}
              >
                <Trash2 className="size-4" /> Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  )
}

function OrganizerFilter({ options, value, onChange }) {
  const [q, setQ] = useState('')
  const selected = new Set(value)
  const needle = q.trim().toLowerCase()
  const shown = needle ? options.filter((o) => o.name?.toLowerCase().includes(needle)) : options
  const label =
    value.length === 0
      ? 'All organizers'
      : value.length === 1
        ? options.find((o) => o.id === value[0])?.name ?? '1 organizer'
        : `${value.length} organizers`

  function toggle(id) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  return (
    <DropdownMenu.Root onOpenChange={(o) => { if (!o) setQ('') }}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-white px-2.5 text-left text-[13px] text-gray-900 shadow-xs outline-none transition-[border-color,box-shadow] hover:border-gray-300 focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/30"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 text-gray-400" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className={cn(menuContent, 'w-[var(--radix-dropdown-menu-trigger-width)] min-w-[220px]')}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {options.length > 8 && (
            <div className="relative mb-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key !== 'Escape' && e.key !== 'ArrowDown') e.stopPropagation() }}
                placeholder="Find organizer"
                className="h-8 w-full rounded-md border-0 bg-gray-50 pl-7 pr-2 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:ring-2 focus:ring-ring/30"
              />
            </div>
          )}
          <DropdownMenu.Item
            className={menuItem}
            onSelect={(e) => { e.preventDefault(); onChange([]) }}
          >
            <span className="flex size-4 items-center justify-center">{value.length === 0 && <Check className="size-4 text-gray-900" />}</span>
            All organizers
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100" />
          <div className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <DropdownMenu.CheckboxItem
                key={o.id}
                checked={selected.has(o.id)}
                onSelect={(e) => { e.preventDefault(); toggle(o.id) }}
                className={menuItem}
              >
                <span className="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator><Check className="size-4 text-gray-900" /></DropdownMenu.ItemIndicator>
                </span>
                <span className={cn('size-2 shrink-0 rounded-full', colorClasses(o.color).dot)} />
                <span className="truncate">{o.name}</span>
              </DropdownMenu.CheckboxItem>
            ))}
            {!shown.length && <div className="px-2 py-3 text-center text-sm text-muted-foreground">No organizers</div>}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * Sidebar calendar picker. In master mode calendars are grouped by organizer.
 *   groups      [{ id, name, color, calendars }] (master)
 *   calendars   calendars currently in scope (after the organizer filter)
 *   hidden      Set of hidden calendar ids
 */
export default function CalendarPicker({
  master = false,
  groups = [],
  calendars = [],
  hidden,
  onToggle,
  onSetMany,
  orgOptions = [],
  orgFilter = [],
  onOrgFilterChange,
  canManage = false,
  onAdd,
  onEdit,
  onDelete,
  showTodos,
  onShowTodosChange,
  loading = false,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const visibleCount = useMemo(() => calendars.filter((c) => !hidden.has(c.id)).length, [calendars, hidden])
  const allOn = calendars.length > 0 && visibleCount === calendars.length
  const someOn = visibleCount > 0 && !allOn

  const toggleGroup = (id) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="space-y-4">
      {master && orgOptions.length > 1 && (
        <OrganizerFilter options={orgOptions} value={orgFilter} onChange={onOrgFilterChange} />
      )}

      <div>
        <div className="mb-1 flex h-7 items-center justify-between pl-1.5">
          <span className="text-xs font-medium text-muted-foreground">Calendars</span>
          {canManage && (
            <button
              type="button"
              onClick={onAdd}
              aria-label="New calendar"
              title="New calendar"
              className="inline-flex size-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>

        {loading && !calendars.length ? (
          <div className="space-y-2 px-1.5 py-1">
            {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-gray-100" style={{ width: `${70 - i * 12}%` }} />)}
          </div>
        ) : !calendars.length ? (
          <div className="px-1.5 py-1 text-sm text-muted-foreground">No calendars</div>
        ) : (
          <div className="space-y-px">
            {calendars.length > 1 && (
              <div className="flex h-8 items-center gap-2.5 rounded-md pl-1.5 transition-colors hover:bg-gray-50">
                <CalCheckbox
                  checked={allOn}
                  indeterminate={someOn}
                  onChange={() => onSetMany(calendars.map((c) => c.id), !allOn)}
                  label="All calendars"
                />
                <button
                  type="button"
                  onClick={() => onSetMany(calendars.map((c) => c.id), !allOn)}
                  className="flex-1 text-left text-sm font-medium text-gray-900"
                >
                  All calendars
                </button>
              </div>
            )}

            {master
              ? groups.map((g) => {
                  const ids = g.calendars.map((c) => c.id)
                  const on = ids.filter((id) => !hidden.has(id)).length
                  const isCollapsed = collapsed.has(g.id)
                  return (
                    <div key={g.id} className="pt-1">
                      <div className="flex h-8 items-center gap-1.5 rounded-md pr-1 transition-colors hover:bg-gray-50">
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.id)}
                          aria-label={isCollapsed ? `Expand ${g.name}` : `Collapse ${g.name}`}
                          aria-expanded={!isCollapsed}
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-900"
                        >
                          {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </button>
                        <CalCheckbox
                          checked={on === ids.length}
                          indeterminate={on > 0 && on < ids.length}
                          color={g.color}
                          onChange={() => onSetMany(ids, on !== ids.length)}
                          label={`All ${g.name} calendars`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.id)}
                          className="min-w-0 flex-1 truncate pl-1 text-left text-[13px] font-medium text-gray-900"
                          title={g.name}
                        >
                          {g.name}
                        </button>
                        {isCollapsed && (
                          <span className="pr-1 text-[11px] tabular-nums text-gray-400">{on}/{ids.length}</span>
                        )}
                      </div>
                      {!isCollapsed && g.calendars.map((cal) => (
                        <CalendarRow
                          key={cal.id}
                          cal={cal}
                          visible={!hidden.has(cal.id)}
                          onToggle={onToggle}
                          indent
                        />
                      ))}
                    </div>
                  )
                })
              : calendars.map((cal) => (
                  <CalendarRow
                    key={cal.id}
                    cal={cal}
                    visible={!hidden.has(cal.id)}
                    onToggle={onToggle}
                    canManage={canManage}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-3">
        <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-md pl-1.5 pr-1 text-sm text-gray-700">
          <span className="flex items-center gap-2">
            <ListChecks className="size-4 text-gray-400" />
            Show to-dos
          </span>
          <Switch size="sm" checked={showTodos} onChange={onShowTodosChange} aria-label="Show to-dos" />
        </label>
      </div>
    </div>
  )
}
