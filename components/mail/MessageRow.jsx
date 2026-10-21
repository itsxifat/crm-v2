'use client'

import { memo } from 'react'
import { Archive, ArchiveRestore, Mail, MailOpen, Paperclip, Star, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { displayName, formatFullDate, formatListDate, shortName } from './mailUtils'
import { Checkbox, MailAvatar, Tip } from './ui'

function QuickAction({ label, shortcut, onClick, children }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        className="inline-flex size-7 items-center justify-center rounded-md text-gray-500 outline-none transition-colors hover:bg-gray-200/70 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4"
      >
        {children}
      </button>
    </Tip>
  )
}

function recipients(item) {
  const list = [...(item.to || []), ...(item.cc || [])]
  if (!list.length) return '(no recipients)'
  const names = list.slice(0, 3).map(shortName).join(', ')
  return list.length > 3 ? `${names} +${list.length - 3}` : names
}

const MessageRow = memo(function MessageRow({
  item, stripeColor, active, cursor, checked, selecting, outgoing,
  onOpen, onToggle, onStar, onQuick, onDragStart,
}) {
  const unseen = item.threadUnread != null ? item.threadUnread > 0 : !item.seen
  const isDraft = item.draft || item.folderRole === 'DRAFTS'
  const showTo = outgoing || isDraft || item.folderRole === 'SENT'
  const role = item.folderRole
  const count = item.threadCount > 1 ? item.threadCount : 0
  const sender = showTo ? recipients(item) : displayName(item.from) || '(unknown sender)'

  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={cursor ? 0 : -1}
      data-row-id={item.id}
      draggable
      onDragStart={(e) => onDragStart?.(e, item)}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) { e.preventDefault(); onToggle(item, e.shiftKey); return }
        onOpen(item)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(item) }}
      className={cn(
        'group relative flex cursor-pointer select-none gap-3 border-b border-gray-100 py-2.5 pl-3 pr-2.5 outline-none transition-colors duration-100',
        active ? 'bg-gray-100' : checked ? 'bg-gray-50' : 'hover:bg-gray-50/80',
        cursor && 'shadow-[inset_2px_0_0_0_#18181b]',
        'focus-visible:bg-gray-50'
      )}
    >
      {stripeColor && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: stripeColor }} />}
      {unseen && <span aria-hidden className="absolute left-[5px] top-[17px] size-1.5 rounded-full bg-blue-600" />}

      {/* Avatar ↔ checkbox */}
      <div
        className="relative mt-0.5 size-8 shrink-0"
        onClick={(e) => { e.stopPropagation(); onToggle(item, e.shiftKey) }}
      >
        <MailAvatar
          addr={showTo ? (item.to?.[0] || item.from) : item.from}
          className={cn('transition-opacity', (selecting || checked) ? 'opacity-0' : 'group-hover:opacity-0')}
        />
        <span className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity',
          (selecting || checked) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}>
          <Checkbox checked={checked} onToggle={(shift) => onToggle(item, shift)} label="Select message" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center gap-1.5">
          <span className={cn('min-w-0 truncate text-[13px]', unseen ? 'font-semibold text-gray-900' : 'text-gray-700')}>
            {isDraft && <span className="mr-1 font-medium text-red-600">Draft</span>}
            {showTo && !isDraft && <span className="text-gray-500">To: </span>}
            {sender}
          </span>
          {count > 0 && (
            <span className="shrink-0 rounded px-1 text-[11px] font-medium tabular-nums leading-4 text-gray-500 ring-1 ring-inset ring-gray-200">{count}</span>
          )}
          {item.priority === 'high' && (
            <Tip label="High priority">
              <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-red-50 text-[10px] font-bold leading-none text-red-600 ring-1 ring-inset ring-red-600/20">!</span>
            </Tip>
          )}

          <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
            {item.hasAttachments && <Paperclip className="size-3.5 text-gray-400 group-hover:hidden" />}
            <time
              dateTime={item.date || undefined}
              title={formatFullDate(item.date)}
              className={cn('text-xs tabular-nums group-hover:hidden', unseen ? 'font-semibold text-gray-900' : 'text-gray-500')}
            >
              {formatListDate(item.date)}
            </time>
            <span className="-my-1 -mr-1 hidden items-center group-hover:flex">
              {!['ARCHIVE', 'TRASH', 'SPAM', 'DRAFTS', 'SENT'].includes(role) && (
                <QuickAction label="Archive" shortcut="E" onClick={() => onQuick(item, 'archive')}><Archive /></QuickAction>
              )}
              {role === 'TRASH' ? (
                <QuickAction label="Restore" onClick={() => onQuick(item, 'restore')}><ArchiveRestore /></QuickAction>
              ) : (
                <QuickAction label="Delete" shortcut="#" onClick={() => onQuick(item, 'trash')}><Trash2 /></QuickAction>
              )}
              {!isDraft && (unseen ? (
                <QuickAction label="Mark as read" onClick={() => onQuick(item, 'read')}><MailOpen /></QuickAction>
              ) : (
                <QuickAction label="Mark as unread" onClick={() => onQuick(item, 'unread')}><Mail /></QuickAction>
              ))}
            </span>
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] leading-5">
            <span className={cn(unseen ? 'font-medium text-gray-900' : 'text-gray-700')}>{item.subject || '(no subject)'}</span>
            {item.snippet && <span className="text-gray-500"> — {item.snippet}</span>}
          </p>
          {!isDraft && (
            <button
              type="button"
              aria-label={item.flagged ? 'Unstar' : 'Star'}
              aria-pressed={item.flagged}
              onClick={(e) => { e.stopPropagation(); onStar(item) }}
              className={cn(
                '-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none transition-all hover:bg-gray-200/70 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50',
                item.flagged ? 'text-amber-500' : 'text-gray-400 opacity-0 hover:text-gray-700 group-hover:opacity-100'
              )}
            >
              <Star className={cn('size-4', item.flagged && 'fill-amber-400')} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

export default MessageRow
