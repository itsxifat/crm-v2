import { addDays, endOfWeek, format } from 'date-fns'
import {
  PRIORITY, PRIORITY_KEYS, TODO_STATUS, TODO_STATUS_KEYS, WEEK_STARTS_ON, fromYMD, toYMD, todayYMD,
} from '../constants'

export const TODO_SORTS = [
  { value: 'position', label: 'Manual' },
  { value: 'due',      label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'status',   label: 'Status' },
  { value: 'title',    label: 'Title' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'created',  label: 'Created' },
  { value: 'updated',  label: 'Updated' },
]

/** Server default direction per sort field (see API contract). */
export function defaultTodoDir(sort) {
  return ['due', 'title', 'organizer', 'position', 'status'].includes(sort) ? 'asc' : 'desc'
}

export const GROUP_OPTIONS = [
  { value: 'none',      label: 'None' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'list',      label: 'List' },
  { value: 'status',    label: 'Status' },
  { value: 'priority',  label: 'Priority' },
  { value: 'due',       label: 'Due date' },
  { value: 'assignee',  label: 'Assignee' },
]

export const DUE_PRESETS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today',   label: 'Today' },
  { value: 'week',    label: 'Next 7 days' },
  { value: 'month',   label: 'Next 30 days' },
  { value: 'has',     label: 'Has a due date' },
  { value: 'none',    label: 'No due date' },
]

export const PRIORITY_DOT = { URGENT: 'bg-red-500', HIGH: 'bg-orange-500', MEDIUM: 'bg-blue-500', LOW: 'bg-gray-300' }

export const STATUS_OPTIONS = TODO_STATUS_KEYS.map((k) => ({ value: k, label: TODO_STATUS[k].label, dotClass: TODO_STATUS[k].dot }))
export const PRIORITY_OPTIONS = PRIORITY_KEYS.map((k) => ({ value: k, label: PRIORITY[k].label, dotClass: PRIORITY_DOT[k] }))

export function isOverdue(todo) {
  return !!todo?.dueDate && todo.status !== 'DONE' && todo.dueDate.slice(0, 10) < todayYMD()
}

/** Short label for a due date: Today / Tomorrow / Yesterday / 12 Nov / 12 Nov 2027. */
export function dueLabel(ymd) {
  if (!ymd) return ''
  const s = ymd.slice(0, 10)
  const today = new Date()
  if (s === toYMD(today)) return 'Today'
  if (s === toYMD(addDays(today, 1))) return 'Tomorrow'
  if (s === toYMD(addDays(today, -1))) return 'Yesterday'
  const d = fromYMD(s)
  return format(d, d.getFullYear() === today.getFullYear() ? 'd MMM' : 'd MMM yyyy')
}

/** 'overdue' | 'today' | 'soon' | 'normal' | 'done' — drives due-date colouring. */
export function dueTone(todo) {
  if (!todo?.dueDate) return 'normal'
  if (todo.status === 'DONE') return 'done'
  const s = todo.dueDate.slice(0, 10)
  const t = todayYMD()
  if (s < t) return 'overdue'
  if (s === t) return 'today'
  if (s === toYMD(addDays(new Date(), 1))) return 'soon'
  return 'normal'
}

export const DUE_TONE_CLASS = {
  overdue: 'text-red-600 font-medium',
  today:   'text-amber-600 font-medium',
  soon:    'text-gray-700',
  normal:  'text-gray-500',
  done:    'text-gray-400',
}

const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue',   dotClass: 'bg-red-500' },
  { key: 'today',   label: 'Today',     dotClass: 'bg-amber-500' },
  { key: 'week',    label: 'This week', dotClass: 'bg-blue-500' },
  { key: 'later',   label: 'Later',     dotClass: 'bg-gray-400' },
  { key: 'earlier', label: 'Earlier',   dotClass: 'bg-gray-300' },
  { key: 'none',    label: 'No date',   dotClass: 'bg-gray-200' },
]

export function dueBucket(todo) {
  if (!todo?.dueDate) return 'none'
  const s = todo.dueDate.slice(0, 10)
  const t = todayYMD()
  if (s < t) return todo.status === 'DONE' ? 'earlier' : 'overdue'
  if (s === t) return 'today'
  const weekEnd = toYMD(endOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }))
  return s <= weekEnd ? 'week' : 'later'
}

/**
 * Client-side grouping over loaded rows. Keeps the server order inside each group.
 * → [{ key, label, color?, dotClass?, avatar?, href?, items }]
 */
export function groupTodos(todos, by) {
  if (!by || by === 'none') return [{ key: 'all', label: null, items: todos }]
  const map = new Map()
  const add = (key, meta, t) => {
    if (!map.has(key)) map.set(key, { key, ...meta, items: [] })
    map.get(key).items.push(t)
  }
  for (const t of todos) {
    switch (by) {
      case 'organizer':
        add(t.organizer?.id ?? 'none', {
          label: t.organizer?.name ?? 'No organizer', color: t.organizer?.color, sortKey: (t.organizer?.name ?? '~').toLowerCase(),
          href: t.organizer?.id ? `/admin/organizer/${t.organizer.id}?tab=todo` : null,
        }, t)
        break
      case 'list':
        add(t.list?.id ?? 'none', {
          label: t.list?.name ?? 'No list', sublabel: t.organizer?.name, color: t.list?.color,
          sortKey: `${(t.organizer?.name ?? '~').toLowerCase()}\u0000${(t.list?.name ?? '~').toLowerCase()}`,
        }, t)
        break
      case 'status':
        add(t.status, { label: TODO_STATUS[t.status]?.label ?? t.status, dotClass: TODO_STATUS[t.status]?.dot, sortKey: TODO_STATUS_KEYS.indexOf(t.status) }, t)
        break
      case 'priority':
        add(t.priority, { label: PRIORITY[t.priority]?.label ?? t.priority, dotClass: PRIORITY_DOT[t.priority], sortKey: PRIORITY_KEYS.indexOf(t.priority) }, t)
        break
      case 'due': {
        const b = dueBucket(t)
        const meta = DUE_BUCKETS.find((x) => x.key === b)
        add(b, { label: meta.label, dotClass: meta.dotClass, sortKey: DUE_BUCKETS.indexOf(meta) }, t)
        break
      }
      case 'assignee':
        add(t.assignee?.id ?? 'none', {
          label: t.assignee?.name ?? 'Unassigned',
          avatar: t.assignee ? { src: t.assignee.avatar, name: t.assignee.name } : null,
          sortKey: t.assignee ? t.assignee.name?.toLowerCase() ?? '' : '￿',
        }, t)
        break
      default:
        add('all', { label: null }, t)
    }
  }
  return [...map.values()].sort((a, b) => {
    if (typeof a.sortKey === 'number' && typeof b.sortKey === 'number') return a.sortKey - b.sortKey
    return String(a.sortKey ?? '').localeCompare(String(b.sortKey ?? ''))
  })
}

/** Keep the status/overdue counts in step with a local edit (prev → next todo). */
export function adjustCounts(counts, prev, next) {
  if (!counts) return counts
  const c = { ...counts }
  if (prev) {
    if (c[prev.status] != null) c[prev.status] = Math.max(0, c[prev.status] - 1)
    if (isOverdue(prev) && c.overdue != null) c.overdue = Math.max(0, c.overdue - 1)
  }
  if (next) {
    c[next.status] = (c[next.status] ?? 0) + 1
    if (isOverdue(next)) c.overdue = (c.overdue ?? 0) + 1
  }
  return c
}

/** Tag normalisation shared with the API rules: lowercase, trimmed, ≤ 30 chars. */
export function normalizeTag(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/^#+/, '').slice(0, 30)
}

export const MAX_TAGS = 10
