'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { colorClasses } from '../constants'
import TodoRow, { TODO_COLS } from './TodoRow'
import { groupTodos } from './utils'

function GroupMarker({ group }) {
  if (group.avatar) return <Avatar src={group.avatar.src} name={group.avatar.name} size="xs" className="!size-5 text-[9px]" />
  if (group.color) return <span className={cn('size-2 shrink-0 rounded-full', colorClasses(group.color).dot)} />
  if (group.dotClass) return <span className={cn('size-2 shrink-0 rounded-full', group.dotClass)} />
  return null
}

/**
 * Master to-do table: responsive rows (columns on xl, compact below), optional
 * client-side grouping over the loaded rows, and "Load more".
 */
export default function TodoTable({
  todos = [],
  groupBy = 'none',
  loading = false,
  canManage = false,
  onToggle,
  onOpen,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  total,
  empty,
}) {
  const groups = useMemo(() => groupTodos(todos, groupBy), [todos, groupBy])
  const [collapsed, setCollapsed] = useState(() => new Set())

  const toggleGroup = (key) =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  return (
    <Card className="overflow-hidden">
      <div className="hidden items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-xs font-medium text-muted-foreground xl:flex">
        <span className="w-[18px] shrink-0" />
        <span className="min-w-0 flex-1">To-do</span>
        <span className={cn('shrink-0', TODO_COLS.organizer)}>Organizer</span>
        <span className={cn('shrink-0', TODO_COLS.list)}>List</span>
        <span className={cn('shrink-0', TODO_COLS.priority)}>Priority</span>
        <span className={cn('shrink-0', TODO_COLS.due)}>Due</span>
        <span className={cn('shrink-0 text-center', TODO_COLS.assignee)}>Assignee</span>
        <span className={cn('shrink-0', TODO_COLS.status)}>Status</span>
      </div>

      {loading ? (
        <div className="py-16"><LoadingSpinner /></div>
      ) : todos.length === 0 ? (
        empty
      ) : (
        groups.map((g) => {
          const isCollapsed = collapsed.has(g.key)
          return (
            <div key={g.key} className="border-b border-gray-100 last:border-b-0">
              {g.label != null && (
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 bg-gray-50/70 px-3 py-2 text-left text-[13px] font-medium text-gray-900 transition-colors hover:bg-gray-100/70 sm:px-4"
                >
                  <ChevronRight className={cn('size-4 shrink-0 text-gray-400 transition-transform', !isCollapsed && 'rotate-90')} />
                  <GroupMarker group={g} />
                  <span className="min-w-0 truncate">{g.label}</span>
                  {g.sublabel && <span className="hidden min-w-0 truncate font-normal text-gray-400 sm:inline">{g.sublabel}</span>}
                  <span className="text-xs font-normal tabular-nums text-gray-400">{g.items.length}</span>
                </button>
              )}
              {!isCollapsed && (
                <div className={cn('divide-y divide-gray-100', g.label != null && 'border-t border-gray-100')}>
                  {g.items.map((t) => (
                    <TodoRow
                      key={t.id}
                      todo={t}
                      columns
                      showOrganizer={groupBy !== 'organizer'}
                      showList={groupBy !== 'list'}
                      canManage={canManage}
                      onToggle={onToggle}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}

      {!loading && hasMore && (
        <div className="flex items-center justify-center gap-3 border-t border-gray-100 px-4 py-3">
          <Button variant="outline" size="sm" loading={loadingMore} onClick={onLoadMore}>
            Load more
          </Button>
          {total != null && (
            <span className="text-xs tabular-nums text-gray-400">
              {todos.length} of {total}
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
