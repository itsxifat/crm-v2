'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { addDays, startOfDay } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, Layers, Loader2, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import Tabs from '@/components/ui/Tabs'
import SearchInput from '@/components/ui/SearchInput'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import { orgFetch } from '../api'
import { fromYMD, toYMD } from '../constants'
import { VIEWS, getRange, normalizeEvent, normalizeTodo, rangeTitle, shiftCursor } from './layout'
import { useNow } from './hooks'
import CalendarPicker from './CalendarPicker'
import MiniMonth from './MiniMonth'
import MonthView from './MonthView'
import TimeGridView from './TimeGridView'
import AgendaView from './AgendaView'
import Popover from './Popover'
import { DayItems, EventDetails, TodoDetails } from './EventDetails'
import EventFormModal from './EventFormModal'
import CalendarFormModal from './CalendarFormModal'

const VIEW_TABS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
]

const calOrgId = (c) => c?.organizerId ?? c?.organizer?.id ?? null

function readPrefs(key) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writePrefs(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

/**
 * Organizer calendar: month / week / day / agenda views over the selected calendars.
 *   organizerId  scope to one organizer (omit for the master calendar across all organizers)
 *   organizers   master only — organizer list used for names/colours in the organizer filter
 *   canManage    create/edit/delete events (and calendars when organizerId is set)
 *   initialView  'month' | 'week' | 'day' | 'agenda' (a remembered view wins)
 *   storageKey   localStorage key for calendar selection, view and "show to-dos"
 */
export function OrganizerCalendar({ organizerId, organizers, canManage = false, initialView = 'month', storageKey }) {
  const master = !organizerId
  const prefsKey = storageKey || `organizer-calendar:${organizerId || 'master'}`
  const now = useNow()

  // ── View state ────────────────────────────────────────────────────────────
  const [ready, setReady] = useState(false)
  const [view, setView] = useState(VIEWS.includes(initialView) ? initialView : 'month')
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [hidden, setHidden] = useState(() => new Set())
  const [orgFilter, setOrgFilter] = useState([])
  const [showTodos, setShowTodos] = useState(false)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  // ── Data ──────────────────────────────────────────────────────────────────
  const [calendars, setCalendars] = useState([])
  const [calLoading, setCalLoading] = useState(true)
  const [calLoaded, setCalLoaded] = useState(false)
  const [rawEvents, setRawEvents] = useState([])
  const [rawTodos, setRawTodos] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // ── Overlays ──────────────────────────────────────────────────────────────
  const [pop, setPop] = useState(null) // { type: 'event'|'todo'|'day'|'calendars', rect?, el?, item?, day?, items? }
  const [eventForm, setEventForm] = useState({ event: null, defaults: null })
  const [eventFormOpen, setEventFormOpen] = useState(false)
  const [calForm, setCalForm] = useState(null)
  const [calFormOpen, setCalFormOpen] = useState(false)
  const closePop = useCallback(() => setPop(null), [])
  // Outside press / Escape / scroll: remember when, so the press that dismissed a
  // popover doesn't also land on the grid underneath and open "New event".
  const dismissedAt = useRef(0)
  const dismissPop = useCallback(() => {
    dismissedAt.current = Date.now()
    setPop(null)
  }, [])

  // Restore preferences after mount (keeps SSR markup stable).
  useEffect(() => {
    const p = readPrefs(prefsKey)
    if (p) {
      if (Array.isArray(p.hidden)) setHidden(new Set(p.hidden))
      if (Array.isArray(p.orgs)) setOrgFilter(p.orgs)
      if (typeof p.showTodos === 'boolean') setShowTodos(p.showTodos)
      if (VIEWS.includes(p.view)) setView(p.view)
    }
    if (!VIEWS.includes(p?.view) && window.innerWidth < 640 && (initialView === 'month' || initialView === 'week')) {
      setView('agenda')
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsKey])

  useEffect(() => {
    if (!ready) return
    writePrefs(prefsKey, { hidden: [...hidden], orgs: orgFilter, showTodos, view })
  }, [ready, prefsKey, hidden, orgFilter, showTodos, view])

  // ── Calendars ─────────────────────────────────────────────────────────────
  const calReq = useRef(0)
  const loadCalendars = useCallback(async () => {
    const req = ++calReq.current
    setCalLoading(true)
    try {
      const json = await orgFetch('/api/organizer/calendars', { query: { organizerIds: organizerId } })
      if (req !== calReq.current) return // a newer load (or another organizer) superseded this one
      const list = Array.isArray(json?.data) ? json.data : []
      setCalendars(list)
      // Forget hidden ids of calendars that no longer exist.
      setHidden((h) => {
        const ids = new Set(list.map((c) => c.id))
        const next = new Set([...h].filter((id) => ids.has(id)))
        return next.size === h.size ? h : next
      })
    } catch (err) {
      if (req === calReq.current) toast.error(err.message || 'Could not load calendars')
    } finally {
      if (req === calReq.current) {
        setCalLoading(false)
        setCalLoaded(true)
      }
    }
  }, [organizerId])

  useEffect(() => { loadCalendars() }, [loadCalendars])

  const orgLookup = useMemo(() => new Map((organizers ?? []).map((o) => [o.id, o])), [organizers])

  const groups = useMemo(() => {
    const map = new Map()
    for (const c of calendars) {
      const id = calOrgId(c) || 'none'
      if (!map.has(id)) {
        const o = c.organizer || orgLookup.get(id) || {}
        map.set(id, { id, name: o.name || 'Organizer', color: o.color || 'zinc', calendars: [] })
      }
      map.get(id).calendars.push(c)
    }
    return [...map.values()]
  }, [calendars, orgLookup])

  const orgOptions = useMemo(() => groups.map((g) => ({ id: g.id, name: g.name, color: g.color })), [groups])
  const activeOrgFilter = useMemo(
    () => (master ? orgFilter.filter((id) => groups.some((g) => g.id === id)) : []),
    [master, orgFilter, groups],
  )
  const scopedGroups = useMemo(
    () => (activeOrgFilter.length ? groups.filter((g) => activeOrgFilter.includes(g.id)) : groups),
    [groups, activeOrgFilter],
  )
  const scopedCalendars = useMemo(
    () => (master ? scopedGroups.flatMap((g) => g.calendars) : calendars),
    [master, scopedGroups, calendars],
  )
  const selectedIds = useMemo(
    () => scopedCalendars.filter((c) => !hidden.has(c.id)).map((c) => c.id),
    [scopedCalendars, hidden],
  )
  const allSelected = selectedIds.length === scopedCalendars.length
  const selectedKey = selectedIds.join(',')
  const orgFilterKey = activeOrgFilter.join(',')

  const toggleCalendar = useCallback((id, visible) => {
    setHidden((h) => {
      const n = new Set(h)
      if (visible) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const setManyCalendars = useCallback((ids, visible) => {
    setHidden((h) => {
      const n = new Set(h)
      ids.forEach((id) => (visible ? n.delete(id) : n.add(id)))
      return n
    })
  }, [])

  // ── Range + events ────────────────────────────────────────────────────────
  const range = useMemo(() => getRange(view, cursor), [view, cursor])
  const rangeKey = `${+range.start}:${+range.end}`
  const title = rangeTitle(view, cursor, range)
  const q = search.trim()

  useEffect(() => {
    if (!ready || !calLoaded) return
    if (!selectedIds.length) {
      setRawEvents([])
      setEventsLoading(false)
      return
    }
    const ctrl = new AbortController()
    const query = {
      // Pad a day each side so all-day (UTC-midnight) events are never clipped by the time zone.
      from: addDays(range.start, -1).toISOString(),
      to: addDays(range.end, 1).toISOString(),
      search: q || undefined,
    }
    if (allSelected) query.organizerIds = organizerId ? [organizerId] : activeOrgFilter
    else query.calendarIds = selectedIds
    setEventsLoading(true)
    // orgFetch swallows a body read aborted mid-way and resolves null — never let a
    // superseded request overwrite the newer range/search with an empty list.
    orgFetch('/api/organizer/events', { query, signal: ctrl.signal })
      .then((json) => { if (!ctrl.signal.aborted) setRawEvents(Array.isArray(json?.data) ? json.data : []) })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        toast.error(err.message || 'Could not load events')
      })
      .finally(() => { if (!ctrl.signal.aborted) setEventsLoading(false) })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, calLoaded, rangeKey, selectedKey, allSelected, orgFilterKey, organizerId, q, reloadKey])

  useEffect(() => {
    if (!ready || !showTodos) {
      setRawTodos([])
      return
    }
    const ctrl = new AbortController()
    orgFetch('/api/organizer/todos', {
      query: {
        due: 'has',
        dueFrom: toYMD(range.start),
        dueTo: toYMD(addDays(range.end, -1)),
        organizerIds: organizerId ? [organizerId] : activeOrgFilter,
        search: q || undefined,
        sort: 'due',
        limit: 500,
      },
      signal: ctrl.signal,
    })
      .then((json) => { if (!ctrl.signal.aborted) setRawTodos(Array.isArray(json?.data) ? json.data : []) })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        toast.error(err.message || 'Could not load to-dos')
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showTodos, rangeKey, orgFilterKey, organizerId, q, reloadKey])

  const items = useMemo(() => {
    const selected = new Set(selectedIds)
    // Filter locally too, so unticking a calendar hides its events before the refetch lands.
    const evs = rawEvents.filter((e) => !e.calendar?.id || selected.has(e.calendar.id)).map(normalizeEvent)
    const todos = showTodos ? rawTodos.filter((t) => t.dueDate).map(normalizeTodo) : []
    return [...evs, ...todos]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawEvents, rawTodos, showTodos, selectedKey])

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToday = useCallback(() => { setPop(null); setCursor(startOfDay(new Date())) }, [])
  const go = useCallback((dir) => { setPop(null); setCursor((c) => shiftCursor(view, c, dir)) }, [view])
  const openDay = useCallback((d) => {
    setPop(null)
    setCursor(startOfDay(d))
    setView('day')
  }, [])
  const changeView = useCallback((v) => { setPop(null); setView(v) }, [])

  // ── Item / overlay handlers ───────────────────────────────────────────────
  const onItemClick = useCallback((item, rect) => {
    setPop({ type: item.kind === 'todo' ? 'todo' : 'event', rect, item })
  }, [])
  const onMore = useCallback((day, dayItems, rect) => {
    setPop({ type: 'day', rect, day, items: dayItems })
  }, [])

  const defaultCalendarId = selectedIds[0] ?? scopedCalendars[0]?.id ?? calendars[0]?.id ?? null

  function openCalendarForm(calendar = null) {
    setPop(null)
    setCalForm({ calendar })
    setCalFormOpen(true)
  }

  function openCreate(defaults) {
    if (!canManage) return
    if (!calendars.length) {
      if (!master) openCalendarForm(null)
      else toast.error('Create a calendar first')
      return
    }
    setPop(null)
    const today = new Date()
    const base = today >= range.start && today < range.end ? today : cursor
    setEventForm({ event: null, defaults: defaults ?? { date: base } })
    setEventFormOpen(true)
  }

  // Clicks on empty grid space: ignore the click whose press just closed a popover.
  function createFromGrid(defaults) {
    if (Date.now() - dismissedAt.current < 600) return
    openCreate(defaults)
  }

  function openEdit(ev) {
    setPop(null)
    setEventForm({ event: ev, defaults: null })
    setEventFormOpen(true)
  }

  function onEventSaved(saved, { created } = {}) {
    reload()
    // Jump to a newly created event that falls outside the visible range.
    if (created && saved?.start) {
      const day = saved.allDay ? fromYMD(saved.start) : startOfDay(new Date(saved.start))
      if (day && (day < range.start || day >= range.end)) setCursor(day)
    }
  }

  async function deleteEvent(ev, mode) {
    try {
      await orgFetch(`/api/organizer/events/${ev.id}`, {
        method: 'DELETE',
        query: mode === 'occurrence' ? { occurrence: ev.occurrenceStart || ev.start } : undefined,
      })
      setRawEvents((list) => list.filter((e) => (mode === 'occurrence' ? e.key !== ev.key : e.id !== ev.id)))
      setPop(null)
      toast.success(mode === 'occurrence' ? 'Occurrence deleted' : 'Event deleted')
    } catch (err) {
      toast.error(err.message || 'Could not delete event')
    }
  }

  async function deleteCalendar(cal) {
    if (!window.confirm(`Delete "${cal.name}" and all of its events?`)) return
    try {
      await orgFetch(`/api/organizer/calendars/${cal.id}`, { method: 'DELETE' })
      setCalendars((list) => list.filter((c) => c.id !== cal.id))
      setRawEvents((list) => list.filter((e) => e.calendar?.id !== cal.id))
      toast.success('Calendar deleted')
    } catch (err) {
      toast.error(err.message || 'Could not delete calendar')
    }
  }

  function onCalendarSaved(cal, { created } = {}) {
    if (created && cal?.id) toggleCalendar(cal.id, true)
    loadCalendars()
    reload()
  }

  // ── Keyboard shortcuts: t today, j/k next/prev, m/w/d/a views, c create ──
  const keyHandler = useRef(null)
  keyHandler.current = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    if (eventFormOpen || calFormOpen) return
    const t = e.target
    if (t?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return
    const k = e.key.toLowerCase()
    if (k === 't') goToday()
    else if (k === 'j' || k === 'n') go(1)
    else if (k === 'k' || k === 'p') go(-1)
    else if (k === 'm') changeView('month')
    else if (k === 'w') changeView('week')
    else if (k === 'd') changeView('day')
    else if (k === 'a') changeView('agenda')
    else if (k === 'c' && canManage) openCreate()
    else return
    e.preventDefault()
  }
  useEffect(() => {
    const fn = (e) => keyHandler.current?.(e)
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  const activeKey = pop && (pop.type === 'event' || pop.type === 'todo') ? pop.item.key : null
  const canManageCalendars = canManage && !master

  const picker = (
    <CalendarPicker
      master={master}
      groups={scopedGroups}
      calendars={scopedCalendars}
      hidden={hidden}
      onToggle={toggleCalendar}
      onSetMany={setManyCalendars}
      orgOptions={orgOptions}
      orgFilter={activeOrgFilter}
      onOrgFilterChange={setOrgFilter}
      canManage={canManageCalendars}
      onAdd={() => openCalendarForm(null)}
      onEdit={(c) => openCalendarForm(c)}
      onDelete={deleteCalendar}
      showTodos={showTodos}
      onShowTodosChange={setShowTodos}
      loading={calLoading}
    />
  )

  const viewProps = {
    days: range.days,
    items,
    now,
    canManage,
    activeKey,
    onItemClick,
    onOpenDay: openDay,
  }

  // Dates depend on the browser's time zone — render nothing date-based on the server.
  if (!ready) {
    return (
      <Card className="py-28">
        <LoadingSpinner />
      </Card>
    )
  }

  let body
  if (!calLoaded) {
    body = <LoadingSpinner className="py-28" />
  } else if (!calendars.length) {
    body = (
      <EmptyState
        icon={CalendarDays}
        title="No calendars"
        className="py-20"
        action={canManageCalendars && (
          <Button size="sm" onClick={() => openCalendarForm(null)}><Plus /> New calendar</Button>
        )}
      />
    )
  } else if (view === 'month') {
    body = (
      <MonthView
        {...viewProps}
        cursor={cursor}
        onCreate={(d) => createFromGrid({ date: d, allDay: true })}
        onMore={onMore}
      />
    )
  } else if (view === 'week' || view === 'day') {
    body = (
      <TimeGridView
        key={view}
        {...viewProps}
        onCreate={(d) => createFromGrid(d)}
      />
    )
  } else {
    body = <AgendaView {...viewProps} master={master} searching={!!q} />
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <aside className="hidden w-64 shrink-0 lg:sticky lg:top-4 lg:block">
        <Card className="max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search events" />
          <MiniMonth
            cursor={cursor}
            rangeStart={range.start}
            rangeEnd={range.end}
            highlightRange={view === 'week'}
            onSelect={(d) => setCursor(startOfDay(d))}
          />
          <div className="border-t border-gray-100 pt-3">{picker}</div>
        </Card>
      </aside>

      <Card className="min-w-0 flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2.5 sm:px-4">
          <div className="order-1 flex min-w-0 flex-1 basis-full items-center gap-1.5 sm:basis-auto">
            <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
            <div className="flex items-center">
              <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} aria-label="Previous" title="Previous">
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => go(1)} aria-label="Next" title="Next">
                <ChevronRight />
              </Button>
            </div>
            <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-gray-900">
              <span className="hidden sm:inline">{title.title}</span>
              <span className="sm:hidden">{title.short}</span>
            </h2>
            {eventsLoading && <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />}
          </div>

          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search events"
            className={cn('order-3 w-full sm:order-2 sm:block sm:w-52 lg:hidden', searchOpen || search ? 'block' : 'hidden')}
          />

          <div className="order-2 flex w-full items-center gap-2 sm:order-3 sm:w-auto">
            <Tabs size="sm" value={view} onChange={changeView} tabs={VIEW_TABS} />
            <div className="flex-1 sm:hidden" />
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn('sm:hidden', (searchOpen || search) && 'bg-accent')}
              onClick={() => setSearchOpen((o) => !o)}
              aria-label="Search events"
            >
              <Search />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="lg:hidden"
              aria-label="Calendars"
              title="Calendars"
              onClick={(e) => {
                const el = e.currentTarget
                setPop((p) => (p?.type === 'calendars' ? null : { type: 'calendars', el }))
              }}
            >
              <Layers />
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => openCreate()} aria-label="New event" disabled={master && !calendars.length && calLoaded}>
                <Plus />
                <span className="hidden sm:inline">New event</span>
              </Button>
            )}
          </div>
        </div>

        {body}
      </Card>

      <Popover
        open={!!pop}
        onClose={dismissPop}
        anchorRect={pop?.rect}
        anchorEl={pop?.el}
        placement={pop?.type === 'calendars' ? 'bottom-end' : pop?.type === 'day' ? 'bottom' : 'side'}
        width={pop?.type === 'day' ? 300 : pop?.type === 'calendars' ? 300 : 360}
        label={pop?.type === 'calendars' ? 'Calendars' : pop?.type === 'day' ? 'Day' : 'Details'}
      >
        {pop?.type === 'event' && (
          <EventDetails
            key={pop.item.key}
            event={pop.item}
            master={master}
            canManage={canManage}
            onEdit={openEdit}
            onDelete={deleteEvent}
            onClose={closePop}
          />
        )}
        {pop?.type === 'todo' && <TodoDetails todo={pop.item} master={master} onClose={closePop} />}
        {pop?.type === 'day' && (
          <DayItems
            day={pop.day}
            items={pop.items}
            activeKey={activeKey}
            onItemClick={onItemClick}
            onOpenDay={openDay}
            onClose={closePop}
          />
        )}
        {pop?.type === 'calendars' && <div className="p-3">{picker}</div>}
      </Popover>

      <EventFormModal
        open={eventFormOpen}
        onOpenChange={setEventFormOpen}
        event={eventForm.event}
        defaults={eventForm.defaults}
        calendars={calendars}
        defaultCalendarId={defaultCalendarId}
        master={master}
        onSaved={onEventSaved}
      />

      {canManageCalendars && (
        <CalendarFormModal
          open={calFormOpen}
          onOpenChange={setCalFormOpen}
          organizerId={organizerId}
          calendar={calForm?.calendar ?? null}
          onSaved={onCalendarSaved}
        />
      )}
    </div>
  )
}

export default OrganizerCalendar
