'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { addDays, startOfDay } from 'date-fns'
import { CalendarDays, CalendarRange, CircleAlert, ListTodo, Plus, SearchX } from 'lucide-react'
import StatsCard from '@/components/ui/StatsCard'
import { Card } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import SearchInput from '@/components/ui/SearchInput'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import OrganizerCard from '../OrganizerCard'
import { orgFetch } from '../api'
import UpcomingEvents, { upcomingItems } from './UpcomingEvents'
import DueSoon from './DueSoon'

const SORTS = [
  { value: 'pinned',  label: 'Pinned first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'name',    label: 'Name' },
  { value: 'created', label: 'Recently created' },
]

const time = (d) => (d ? new Date(d).getTime() : 0)
const SORTERS = {
  pinned:  (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || time(b.updatedAt) - time(a.updatedAt),
  updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
  name:    (a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }),
  created: (a, b) => time(b.createdAt) - time(a.createdAt),
}

/**
 * Dashboard "Overview" tab: stats, the organizer grid (filtered client-side from the
 * full list the page loads), then upcoming events and to-dos due soon.
 * `version` bumps whenever an organizer is archived/deleted so the side lists refetch.
 */
export default function OrganizerOverview({
  organizers = [],
  loading,
  error,
  onRetry,
  onRefresh,
  canManage,
  version = 0,
  onNew,
  onEdit,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onTabChange,
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [clientId, setClientId] = useState('all')
  const [sort, setSort] = useState('pinned')

  const [events, setEvents] = useState({ items: [], loading: true, error: null })
  const [todos, setTodos] = useState({ items: [], counts: null, loading: true, error: null })
  const [todosTick, setTodosTick] = useState(0)

  // Event occurrences from the start of today through the next 7 days.
  useEffect(() => {
    const ctrl = new AbortController()
    const from = startOfDay(new Date())
    orgFetch('/api/organizer/events', {
      query: { from: from.toISOString(), to: addDays(from, 7).toISOString() },
      signal: ctrl.signal,
    })
      .then((json) => setEvents({ items: upcomingItems(json?.data), loading: false, error: null }))
      .catch((err) => {
        if (!ctrl.signal.aborted) setEvents({ items: [], loading: false, error: err.message })
      })
    return () => ctrl.abort()
  }, [version])

  // To-dos due this week + overall status counts (meta.counts ignores the status filter).
  useEffect(() => {
    const ctrl = new AbortController()
    const { signal } = ctrl
    Promise.allSettled([
      orgFetch('/api/organizer/todos', {
        query: { due: 'week', status: ['OPEN', 'IN_PROGRESS'], sort: 'due', limit: 8 },
        signal,
      }),
      orgFetch('/api/organizer/todos', { query: { limit: 1 }, signal }),
    ]).then(([soon, all]) => {
      if (signal.aborted) return
      setTodos({
        items: soon.status === 'fulfilled' ? soon.value?.data ?? [] : [],
        error: soon.status === 'rejected' ? soon.reason?.message ?? 'Failed to load' : null,
        counts: all.status === 'fulfilled' ? all.value?.meta?.counts ?? null : null,
        loading: false,
      })
    })
    return () => ctrl.abort()
  }, [version, todosTick])

  async function completeTodo(todo) {
    setTodos((s) => ({ ...s, items: s.items.filter((t) => t.id !== todo.id) }))
    try {
      await orgFetch(`/api/organizer/todos/${todo.id}`, { method: 'PATCH', body: { status: 'DONE' } })
      toast.success('Marked as done')
      onRefresh?.()
    } catch (err) {
      toast.error(err.message)
    }
    setTodosTick((n) => n + 1)
  }

  // ── Stats ──
  const active = organizers.filter((o) => o.status !== 'ARCHIVED')
  const archivedCount = organizers.length - active.length
  const sum = (key) => active.reduce((n, o) => n + (o.counts?.[key] ?? 0), 0)
  const counts = todos.counts
  const openTodos = counts ? (counts.OPEN ?? 0) + (counts.IN_PROGRESS ?? 0) : sum('todosOpen')
  const overdue = counts ? counts.overdue ?? 0 : sum('todosOverdue')
  const todosReady = !todos.loading

  // ── Grid filters ──
  const clientOptions = useMemo(() => {
    const byId = new Map()
    let unassigned = false
    for (const o of organizers) {
      if (o.client?.id) byId.set(o.client.id, o.client.name || 'Client')
      else unassigned = true
    }
    const list = [...byId]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, label]) => ({ value, label }))
    return [
      { value: 'all', label: 'All clients' },
      ...list,
      ...(unassigned ? [{ value: 'none', label: 'No client' }] : []),
    ]
  }, [organizers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return organizers
      .filter((o) => status === 'ALL' || o.status === status)
      .filter((o) => clientId === 'all' || (clientId === 'none' ? !o.client : o.client?.id === clientId))
      .filter((o) => {
        if (!q) return true
        const hay = [o.name, o.description, o.client?.name, ...(o.projects ?? []).map((p) => p.name)]
        return hay.some((s) => s && s.toLowerCase().includes(q))
      })
      .sort(SORTERS[sort] ?? SORTERS.pinned)
  }, [organizers, search, status, clientId, sort])

  const hasFilters = !!search.trim() || status !== 'ACTIVE' || clientId !== 'all'
  function resetFilters() {
    setSearch('')
    setStatus('ACTIVE')
    setClientId('all')
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatsCard title="Organizers" value={loading ? '—' : active.length} icon={CalendarRange} />
        <StatsCard
          title="Events"
          value={events.loading ? '—' : events.items.length}
          changeLabel="Next 7 days"
          icon={CalendarDays}
          color="blue"
          href="/admin/organizer?tab=calendar"
        />
        <StatsCard
          title="Open to-dos"
          value={todosReady ? openTodos : '—'}
          icon={ListTodo}
          href="/admin/organizer?tab=todo"
        />
        <StatsCard
          title="Overdue"
          value={todosReady ? overdue : '—'}
          icon={CircleAlert}
          color={overdue > 0 ? 'red' : 'gray'}
          href="/admin/organizer?tab=todo&t_due=overdue"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search organizers…" className="w-full sm:w-64" />
        <Tabs
          size="sm"
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'ACTIVE', label: 'Active', count: loading ? undefined : active.length },
            { value: 'ARCHIVED', label: 'Archived', count: loading ? undefined : archivedCount },
            { value: 'ALL', label: 'All' },
          ]}
        />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Select
            value={clientId}
            onChange={(v) => setClientId(v ?? 'all')}
            options={clientOptions}
            className="min-w-0 flex-1 sm:w-48 sm:flex-none"
          />
          <Select
            value={sort}
            onChange={(v) => setSort(v ?? 'pinned')}
            options={SORTS}
            className="min-w-0 flex-1 sm:w-44 sm:flex-none"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Clear
          </Button>
        )}
      </div>

      {/* Organizer grid */}
      {loading ? (
        <GridSkeleton />
      ) : error ? (
        <Card>
          <EmptyState
            icon={CircleAlert}
            title="Couldn't load organizers"
            description={error}
            action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
          />
        </Card>
      ) : organizers.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarRange}
            title="No organizers yet"
            action={canManage ? <Button onClick={onNew}><Plus /> New organizer</Button> : null}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title="No organizers match"
            action={hasFilters ? <Button variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button> : null}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => (
            <OrganizerCard
              key={o.id}
              organizer={o}
              canManage={canManage}
              onEdit={onEdit}
              onTogglePin={onTogglePin}
              onToggleArchive={onToggleArchive}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {/* Upcoming + due soon */}
      <div className="grid gap-4 lg:grid-cols-2">
        <UpcomingEvents
          items={events.items}
          loading={events.loading}
          error={events.error}
          onViewAll={onTabChange ? () => onTabChange('calendar') : undefined}
        />
        <DueSoon
          todos={todos.items}
          loading={todos.loading}
          error={todos.error}
          canManage={canManage}
          onComplete={completeTodo}
          onViewAll={onTabChange ? () => onTabChange('todo') : undefined}
        />
      </div>
    </div>
  )
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="overflow-hidden">
          <div className="animate-pulse">
            <div className="h-1 bg-gray-100" />
            <div className="space-y-2.5 px-5 pb-4 pt-5">
              <div className="h-4 w-1/2 rounded bg-gray-100" />
              <div className="h-3 w-1/3 rounded bg-gray-100" />
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-gray-100 px-3.5 py-3">
              {[0, 1, 2].map((j) => (
                <div key={j} className="space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-gray-100" />
                  <div className="h-3.5 w-1/3 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
