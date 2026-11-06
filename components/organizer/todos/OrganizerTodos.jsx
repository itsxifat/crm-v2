'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Building2, CalendarClock, CalendarRange, CircleDashed, Columns3, Flag, FolderKanban,
  ListTodo, Plus, Rows3, Tag, UserRound, UserX,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Tabs from '@/components/ui/Tabs'
import { orgFetch } from '../api'
import FilterBar from '../filters/FilterBar'
import { isSameValue, useUrlFilters } from '../filters/useUrlFilters'
import StatusChips from './StatusChips'
import TodoBoard, { splitByList } from './TodoBoard'
import TodoTable from './TodoTable'
import TodoFormModal from './TodoFormModal'
import ListFormModal from './ListFormModal'
import { searchPeople, useOrganizers, usePersistentState, useTagSuggestions } from './hooks'
import {
  DUE_PRESETS, GROUP_OPTIONS, PRIORITY_OPTIONS, STATUS_OPTIONS, TODO_SORTS, adjustCounts, defaultTodoDir,
} from './utils'

const FILTER_KEYS = ['q', 'org', 'client', 'status', 'priority', 'assignee', 'due', 'from', 'to', 'tags']

const MASTER_DEFAULTS = {
  q: '', org: [], client: '', status: [], priority: [], assignee: [], due: '', from: '', to: '', tags: [],
  sort: 'due', dir: '', group: 'none',
}
const ORGANIZER_DEFAULTS = {
  q: '', status: [], priority: [], assignee: [], due: '', from: '', to: '', tags: [],
  sort: 'position', dir: '',
}

const listRef = (l) => (l ? { id: l.id, name: l.name, color: l.color } : null)

/**
 * To-dos for one organizer (`organizerId`: lists as sections/columns, quick add, drag reorder)
 * or for all organizers (master table with grouping). Uses useSearchParams — render inside <Suspense>.
 */
export default function OrganizerTodos({ organizerId, organizers: organizersProp, canManage = false }) {
  const isMaster = !organizerId
  const organizers = useOrganizers(organizersProp, isMaster)
  const tagSuggestions = useTagSuggestions()

  const { filters, setFilters, reset, defaults } = useUrlFilters('t_', isMaster ? MASTER_DEFAULTS : ORGANIZER_DEFAULTS)
  const [storedView, setView] = usePersistentState('org-todos-view', 'list')
  const view = storedView === 'board' ? 'board' : 'list'

  const [todos, setTodos] = useState([])
  const [meta, setMeta] = useState(null)
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lists, setLists] = useState([])
  const [listsLoading, setListsLoading] = useState(!isMaster)
  const [editor, setEditor] = useState({ open: false, todo: null, listId: null })
  const [listEditor, setListEditor] = useState({ open: false, list: null })
  const [peopleNames, setPeopleNames] = useState({})

  const todosRef = useRef(todos)
  todosRef.current = todos
  const listsRef = useRef(lists)
  listsRef.current = lists

  const limit = isMaster ? 100 : 500
  const sort = filters.sort || defaults.sort
  const dir = filters.dir || defaultTodoDir(sort)
  const filtersActive = FILTER_KEYS.some((k) => k in defaults && !isSameValue(filters[k], defaults[k]))
  // Manual order is shown ascending (drag targets assume it); descending falls back to the server order.
  const manual = !isMaster && sort === 'position' && dir === 'asc'
  const dragEnabled = canManage && manual && !filtersActive

  // ── Data ───────────────────────────────────────────────────────────────────
  const query = useMemo(() => ({
    organizerIds: isMaster ? filters.org : [organizerId],
    clientId: isMaster ? filters.client : '',
    status: filters.status,
    priority: filters.priority,
    assigneeIds: filters.assignee,
    tags: filters.tags,
    due: filters.due,
    dueFrom: filters.from,
    dueTo: filters.to,
    search: (filters.q ?? '').trim(),
    sort,
    dir,
    limit,
  }), [isMaster, organizerId, filters, sort, dir, limit])
  const queryKey = JSON.stringify(query)

  const reqId = useRef(0)
  const load = useCallback(async (page = 1) => {
    const id = ++reqId.current
    if (page === 1) setLoading(true)
    else setLoadingMore(true)
    try {
      const json = await orgFetch('/api/organizer/todos', { query: { ...JSON.parse(queryKey), page } })
      if (id !== reqId.current) return
      const rows = json?.data ?? []
      setTodos((prev) => {
        if (page === 1) return rows
        const seen = new Set(prev.map((t) => t.id))
        return [...prev, ...rows.filter((t) => !seen.has(t.id))]
      })
      setMeta(json?.meta ?? null)
      setCounts(json?.meta?.counts ?? null)
    } catch (err) {
      if (id === reqId.current) toast.error(err.message || 'Could not load to-dos')
    } finally {
      if (id === reqId.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [queryKey])

  useEffect(() => { load(1) }, [load])

  const loadLists = useCallback(async () => {
    if (isMaster) return
    try {
      const json = await orgFetch('/api/organizer/lists', { query: { organizerIds: organizerId } })
      setLists((json?.data ?? []).filter((l) => !l.organizerId || l.organizerId === organizerId))
    } catch (err) {
      toast.error(err.message || 'Could not load lists')
    } finally {
      setListsLoading(false)
    }
  }, [isMaster, organizerId])

  useEffect(() => { loadLists() }, [loadLists])

  // Names for assignee chips (from loaded rows + people searches).
  useEffect(() => {
    const add = {}
    for (const t of todos) if (t.assignee && !peopleNames[t.assignee.id]) add[t.assignee.id] = t.assignee.name
    if (Object.keys(add).length) setPeopleNames((p) => ({ ...p, ...add }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos])

  const loadPeople = useCallback(async (q) => {
    const data = await searchPeople(q)
    setPeopleNames((p) => ({ ...p, ...Object.fromEntries(data.map((u) => [u.id, u.name])) }))
    return data.map((u) => ({ value: u.id, label: u.name, avatar: { src: u.avatar, name: u.name } }))
  }, [])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const patchLocal = (id, fn) => setTodos((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))

  const toggle = useCallback(async (todo) => {
    if (!canManage) return
    const status = todo.status === 'DONE' ? 'OPEN' : 'DONE'
    const optimistic = { ...todo, status, completedAt: status === 'DONE' ? new Date().toISOString() : null }
    patchLocal(todo.id, () => optimistic)
    setCounts((c) => adjustCounts(c, todo, optimistic))
    try {
      const json = await orgFetch(`/api/organizer/todos/${todo.id}`, { method: 'PATCH', body: { status } })
      if (json?.data) patchLocal(todo.id, (t) => ({ ...t, ...json.data }))
    } catch (err) {
      patchLocal(todo.id, () => todo)
      setCounts((c) => adjustCounts(c, optimistic, todo))
      toast.error(err.message || 'Could not update to-do')
    }
  }, [canManage])

  const reorder = useCallback(async (listId, ids, extra = {}) => {
    const before = new Map(todosRef.current.filter((t) => ids.includes(t.id)).map((t) => [t.id, t]))
    setTodos((ts) => ts.map((t) => {
      const i = ids.indexOf(t.id)
      return i < 0 ? t : { ...t, position: i, ...(extra[t.id] ?? {}) }
    }))
    try {
      await orgFetch('/api/organizer/todos/reorder', { method: 'POST', body: { listId, ids } })
    } catch (err) {
      setTodos((ts) => ts.map((t) => before.get(t.id) ?? t))
      toast.error(err.message || 'Could not reorder')
    }
  }, [])

  const move = useCallback(({ todoId, fromListId, toListId, toIndex }) => {
    const all = todosRef.current
    const moved = all.find((t) => t.id === todoId)
    if (!moved) return
    const split = splitByList(all.filter((t) => t.id !== todoId), true)
    const dest = split[toListId] ?? { active: [], done: [] }
    const active = [...dest.active]
    active.splice(toIndex, 0, moved)
    const ids = [...active, ...dest.done].map((t) => t.id)
    const toList = listsRef.current.find((l) => l.id === toListId)
    const extra = fromListId !== toListId && toList ? { [todoId]: { list: listRef(toList) } } : {}
    reorder(toListId, ids, extra)
  }, [reorder])

  const quickAdd = useCallback(async (listId, title) => {
    try {
      const json = await orgFetch('/api/organizer/todos', { method: 'POST', body: { listId, title } })
      const created = json?.data
      if (!created) return
      setTodos((ts) => [...ts, created])
      setCounts((c) => adjustCounts(c, null, created))
      setMeta((m) => (m ? { ...m, total: (m.total ?? 0) + 1 } : m))
      // New items go to the top of the list (the API appends them).
      if (dragEnabled) {
        const split = splitByList(todosRef.current.filter((t) => t.id !== created.id), true)
        const dest = split[listId] ?? { active: [], done: [] }
        reorder(listId, [created.id, ...dest.active.map((t) => t.id), ...dest.done.map((t) => t.id)])
      }
    } catch (err) {
      toast.error(err.message || 'Could not add to-do')
      throw err
    }
  }, [dragEnabled, reorder])

  function onSaved(todo, { created }) {
    if (created) {
      setTodos((ts) => (isMaster ? [todo, ...ts] : [...ts, todo]))
      setCounts((c) => adjustCounts(c, null, todo))
      setMeta((m) => (m ? { ...m, total: (m.total ?? 0) + 1 } : m))
    } else {
      const prev = todosRef.current.find((t) => t.id === todo.id)
      patchLocal(todo.id, (t) => ({ ...t, ...todo }))
      setCounts((c) => adjustCounts(c, prev, todo))
    }
  }

  function onDeleted(id) {
    const prev = todosRef.current.find((t) => t.id === id)
    setTodos((ts) => ts.filter((t) => t.id !== id))
    setCounts((c) => adjustCounts(c, prev, null))
    setMeta((m) => (m ? { ...m, total: Math.max(0, (m.total ?? 1) - 1) } : m))
  }

  function onListSaved(list, { created }) {
    if (created) {
      setLists((ls) => [...ls, list])
    } else {
      setLists((ls) => ls.map((l) => (l.id === list.id ? { ...l, ...list } : l)))
      setTodos((ts) => ts.map((t) => (t.list?.id === list.id ? { ...t, list: listRef(list) } : t)))
    }
    toast.success(created ? 'List created' : 'List updated')
  }

  async function deleteList(list) {
    const n = todosRef.current.filter((t) => t.list?.id === list.id).length
    const msg = n ? `Delete "${list.name}" and its ${n} to-do${n === 1 ? '' : 's'}?` : `Delete "${list.name}"?`
    if (!confirm(msg)) return
    try {
      await orgFetch(`/api/organizer/lists/${list.id}`, { method: 'DELETE' })
      setLists((ls) => ls.filter((l) => l.id !== list.id))
      setTodos((ts) => ts.filter((t) => t.list?.id !== list.id))
      toast.success('List deleted')
      load(1)
    } catch (err) {
      toast.error(err.message || 'Could not delete list')
    }
  }

  const openTodo = useCallback((todo) => setEditor({ open: true, todo, listId: null }), [])
  const openCreate = () => setEditor({ open: true, todo: null, listId: lists[0]?.id ?? null })

  // ── Filter bar config ──────────────────────────────────────────────────────
  const organizerOptions = useMemo(
    () => organizers.map((o) => ({ value: o.id, label: o.name, color: o.color })),
    [organizers]
  )
  const clientOptions = useMemo(() => {
    const m = new Map()
    for (const o of organizers) if (o.client?.id && !m.has(o.client.id)) m.set(o.client.id, { value: o.client.id, label: o.client.name || 'Client' })
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [organizers])
  const tagOptions = useMemo(() => tagSuggestions.map((t) => ({ value: t, label: `#${t}` })), [tagSuggestions])

  const assigneeLabel = useCallback(
    (v) => (v === 'me' ? 'Me' : v === 'none' ? 'Unassigned' : peopleNames[v] ?? 'Someone'),
    [peopleNames]
  )

  const fields = [
    isMaster && { type: 'multi', key: 'org', label: 'Organizer', icon: FolderKanban, options: organizerOptions, searchable: true },
    isMaster && clientOptions.length > 0 && { type: 'select', key: 'client', label: 'Client', icon: Building2, options: clientOptions },
    { type: 'multi', key: 'status', label: 'Status', icon: CircleDashed, options: STATUS_OPTIONS, searchable: false },
    { type: 'multi', key: 'priority', label: 'Priority', icon: Flag, options: PRIORITY_OPTIONS, searchable: false },
    {
      type: 'multi', key: 'assignee', label: 'Assignee', icon: UserRound,
      options: [{ value: 'me', label: 'Me', icon: UserRound }, { value: 'none', label: 'Unassigned', icon: UserX }],
      loadOptions: loadPeople, getLabel: assigneeLabel, placeholder: 'Search people…',
    },
    { type: 'select', key: 'due', label: 'Due', icon: CalendarClock, options: DUE_PRESETS, searchable: false },
    { type: 'dateRange', fromKey: 'from', toKey: 'to', label: 'Due between', icon: CalendarRange },
    { type: 'multi', key: 'tags', label: 'Tags', icon: Tag, options: tagOptions, getLabel: (v) => `#${v}`, emptyText: 'No tags' },
  ]

  const sortOptions = TODO_SORTS.filter((s) => (isMaster ? s.value !== 'position' : s.value !== 'organizer'))

  const viewToggle = !isMaster && (
    <Tabs
      size="sm"
      value={view}
      onChange={setView}
      tabs={[
        { value: 'list', label: 'List', icon: Rows3 },
        { value: 'board', label: 'Board', icon: Columns3 },
      ]}
    />
  )

  const hasMore = !!meta && (meta.page ?? 1) < (meta.pages ?? 1)
  // Not while page 1 of a new query is in flight: its next page would be appended to the old rows.
  const loadMore = () => { if (!loading && !loadingMore) load((meta?.page ?? 1) + 1) }
  const statusFilter = Array.isArray(filters.status) ? filters.status : []
  const forceShowDone = statusFilter.includes('DONE')

  const emptyNode = (
    <EmptyState
      icon={ListTodo}
      title={filtersActive ? 'No matching to-dos' : 'No to-dos yet'}
      action={filtersActive ? (
        <Button variant="outline" size="sm" onClick={() => reset(FILTER_KEYS.filter((k) => k in defaults))}>Clear filters</Button>
      ) : canManage && (isMaster || lists.length > 0) ? (
        <Button size="sm" onClick={openCreate}><Plus /> New to-do</Button>
      ) : null}
    />
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  let body
  if (isMaster) {
    body = (
      <TodoTable
        todos={todos}
        groupBy={filters.group}
        loading={loading && !todos.length}
        canManage={canManage}
        onToggle={toggle}
        onOpen={openTodo}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        total={meta?.total}
        empty={emptyNode}
      />
    )
  } else if ((loading && !todos.length) || listsLoading) {
    body = <Card className="py-16"><LoadingSpinner /></Card>
  } else if (!lists.length) {
    body = (
      <Card>
        <EmptyState
          icon={ListTodo}
          title="No lists yet"
          action={canManage && (
            <Button size="sm" onClick={() => setListEditor({ open: true, list: null })}><Plus /> New list</Button>
          )}
        />
      </Card>
    )
  } else if (filtersActive && !todos.length && !loading) {
    body = <Card>{emptyNode}</Card>
  } else {
    body = (
      <>
        <TodoBoard
          lists={lists}
          todos={todos}
          view={view}
          manual={manual}
          dragEnabled={dragEnabled}
          hideEmptyLists={filtersActive}
          forceShowDone={forceShowDone}
          canManage={canManage}
          onQuickAdd={quickAdd}
          onToggle={toggle}
          onOpen={openTodo}
          onMove={move}
          onEditList={(list) => setListEditor({ open: true, list })}
          onDeleteList={deleteList}
          onNewList={() => setListEditor({ open: true, list: null })}
        />
        {hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" loading={loadingMore} onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChips
          counts={counts}
          status={statusFilter}
          due={filters.due}
          onSelect={(patch) => setFilters(patch)}
        />
        <div className="flex flex-wrap items-center gap-2">
          {viewToggle}
          {canManage && !isMaster && (
            <Button variant="outline" size="sm" onClick={() => setListEditor({ open: true, list: null })}>
              <Plus /> New list
            </Button>
          )}
          {canManage && (isMaster || lists.length > 0) && (
            <Button size="sm" onClick={openCreate}>
              <Plus /> New to-do
            </Button>
          )}
        </div>
      </div>

      <FilterBar
        values={filters}
        defaults={defaults}
        onChange={setFilters}
        onReset={() => reset()}
        search={{ key: 'q', placeholder: 'Search to-dos' }}
        fields={fields}
        sort={{ key: 'sort', dirKey: 'dir', options: sortOptions, defaultDir: defaultTodoDir }}
        group={isMaster ? { key: 'group', options: GROUP_OPTIONS } : undefined}
      />

      <div className={loading && todos.length ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {body}
      </div>

      <TodoFormModal
        open={editor.open}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        todo={editor.todo}
        organizerId={organizerId}
        lists={isMaster ? undefined : lists}
        defaultListId={editor.listId}
        canManage={canManage}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />

      {!isMaster && (
        <ListFormModal
          open={listEditor.open}
          onOpenChange={(open) => setListEditor((e) => ({ ...e, open }))}
          organizerId={organizerId}
          list={listEditor.list}
          onSaved={onListSaved}
        />
      )}
    </div>
  )
}

export { OrganizerTodos }
