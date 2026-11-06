'use client'

import { useMemo } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import TodoListSection from './TodoListSection'

const byPosition = (a, b) =>
  (a.position ?? 0) - (b.position ?? 0) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))

/** Split loaded to-dos into { [listId]: { active, done } }; manual mode orders by position. */
export function splitByList(todos, manual) {
  const map = {}
  for (const t of todos) {
    const id = t.list?.id ?? 'none'
    if (!map[id]) map[id] = { active: [], done: [] }
    map[id][t.status === 'DONE' ? 'done' : 'active'].push(t)
  }
  if (manual) {
    for (const k of Object.keys(map)) {
      map[k].active.sort(byPosition)
      map[k].done.sort(byPosition)
    }
  }
  return map
}

/**
 * Organizer-mode to-dos: one section (list view) or column (board view) per list.
 *   onMove({ todoId, fromListId, toListId, toIndex })  — called after a drop
 */
export default function TodoBoard({
  lists = [],
  todos = [],
  view = 'list',
  manual = false,
  dragEnabled = false,
  hideEmptyLists = false,
  forceShowDone = false,
  canManage = false,
  onQuickAdd,
  onToggle,
  onOpen,
  onMove,
  onEditList,
  onDeleteList,
  onNewList,
}) {
  const grouped = useMemo(() => splitByList(todos, manual), [todos, manual])

  const visibleLists = hideEmptyLists
    ? lists.filter((l) => (grouped[l.id]?.active.length ?? 0) + (grouped[l.id]?.done.length ?? 0) > 0)
    : lists

  function onDragEnd(result) {
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return
    onMove?.({
      todoId: draggableId,
      fromListId: source.droppableId,
      toListId: destination.droppableId,
      toIndex: destination.index,
    })
  }

  const sections = visibleLists.map((list) => (
    <TodoListSection
      key={list.id}
      list={list}
      view={view}
      active={grouped[list.id]?.active ?? []}
      done={grouped[list.id]?.done ?? []}
      canManage={canManage}
      dragEnabled={dragEnabled}
      forceShowDone={forceShowDone}
      onQuickAdd={onQuickAdd}
      onToggle={onToggle}
      onOpen={onOpen}
      onEditList={onEditList}
      onDeleteList={onDeleteList}
    />
  ))

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {view === 'board' ? (
        <div className="overflow-x-auto pb-3">
          <div className="flex snap-x items-start gap-4">
            {sections}
            {canManage && onNewList && !hideEmptyLists && (
              <button
                type="button"
                onClick={onNewList}
                className={cn(
                  'flex h-12 w-[85vw] max-w-[340px] shrink-0 snap-start items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300',
                  'text-sm font-medium text-gray-500 transition-colors hover:border-gray-400 hover:bg-white hover:text-gray-900 sm:w-[320px]'
                )}
              >
                <Plus className="size-4" />
                New list
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">{sections}</div>
      )}
    </DragDropContext>
  )
}
