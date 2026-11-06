'use client'

import { useRef, useState } from 'react'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import ActionMenu from '@/components/ui/ActionMenu'
import { colorClasses } from '../constants'
import TodoRow from './TodoRow'

function QuickAdd({ onAdd }) {
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  async function submit(e) {
    e.preventDefault()
    const title = text.trim()
    if (!title) return
    setText('') // optimistic: keep typing the next one
    try {
      await onAdd(title)
    } catch {
      setText((cur) => cur || title)
    }
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-3 px-3 pb-2 sm:px-4">
      <span className="flex size-[18px] shrink-0 items-center justify-center text-gray-400">
        <Plus className="size-4" />
      </span>
      <input
        ref={inputRef}
        value={text}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a to-do"
        className="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
      />
    </form>
  )
}

/**
 * One to-do list: a section (list view) or a column (board view).
 *   active / done   to-dos of this list, already ordered
 *   dragEnabled     wraps rows in @hello-pangea/dnd (DragDropContext lives in TodoBoard)
 */
export default function TodoListSection({
  list,
  active = [],
  done = [],
  view = 'list',
  canManage = false,
  dragEnabled = false,
  forceShowDone = false,
  onQuickAdd,
  onToggle,
  onOpen,
  onEditList,
  onDeleteList,
}) {
  const [showDone, setShowDone] = useState(false)
  const board = view === 'board'
  const c = colorClasses(list.color)
  const doneOpen = showDone || forceShowDone

  const rowProps = { canManage, onToggle, onOpen }

  return (
    <Card className={cn('flex flex-col overflow-hidden', board && 'w-[85vw] max-w-[340px] shrink-0 snap-start sm:w-[320px]')}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3 sm:px-4">
        <span className={cn('size-2.5 shrink-0 rounded-full', c.dot)} />
        <h3 className="min-w-0 truncate text-sm font-semibold text-gray-900">{list.name}</h3>
        <span className="text-xs tabular-nums text-gray-400">{active.length}</span>
        {canManage && (
          <div className="-my-1 ml-auto">
            <ActionMenu
              items={[
                { label: 'Edit list', icon: Pencil, onClick: () => onEditList?.(list) },
                { label: 'Delete list', icon: Trash2, danger: true, onClick: () => onDeleteList?.(list) },
              ]}
            />
          </div>
        )}
      </div>

      {canManage && <QuickAdd onAdd={(title) => onQuickAdd?.(list.id, title)} />}

      {dragEnabled ? (
        <Droppable droppableId={list.id}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={cn(
                'min-h-[44px] divide-y divide-gray-100 border-t border-gray-100 transition-colors',
                snapshot.isDraggingOver && 'bg-gray-50/80'
              )}
            >
              {active.map((t, i) => (
                <Draggable key={t.id} draggableId={t.id} index={i}>
                  {(p, s) => (
                    <div ref={p.innerRef} {...p.draggableProps}>
                      <TodoRow todo={t} {...rowProps} dragHandleProps={p.dragHandleProps} isDragging={s.isDragging} />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
              {active.length === 0 && !snapshot.isDraggingOver && (
                <p className="px-4 py-3 text-center text-xs text-gray-400">{done.length ? 'No open to-dos' : 'No to-dos'}</p>
              )}
            </div>
          )}
        </Droppable>
      ) : (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {active.map((t) => <TodoRow key={t.id} todo={t} {...rowProps} />)}
          {active.length === 0 && done.length === 0 && (
            <p className="px-4 py-3 text-center text-xs text-gray-400">No to-dos</p>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            aria-expanded={doneOpen}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:px-4"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', doneOpen && 'rotate-90')} />
            Done
            <span className="tabular-nums text-gray-400">{done.length}</span>
          </button>
          {doneOpen && (
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {done.map((t) => <TodoRow key={t.id} todo={t} {...rowProps} />)}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
