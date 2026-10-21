'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArchiveRestore, ArrowLeft, ChevronDown, ChevronUp, Code, Download, FolderInput, Forward, Inbox, Mail, OctagonAlert,
  Pencil, Printer, Reply, ReplyAll, ShieldCheck, Star, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ActionMenu from '@/components/ui/ActionMenu'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import MoveToMenu from './MoveToMenu'
import ThreadMessage, { replyAllPossible } from './ThreadMessage'
import { printMessage } from './EmailFrame'
import { mailApi } from './mailApi'
import { formatAddress, formatFullDate, roleLabel } from './mailUtils'
import { AccountDot, IconButton, Skeleton } from './ui'

function ReaderSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6" aria-hidden>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="mt-3 h-4 w-20 rounded-full" />
      <div className="mt-6 rounded-xl border border-gray-200/80 p-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="mt-6 space-y-2.5 sm:pl-12">
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
    </div>
  )
}

function downloadFile(url) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** The conversation for one opened message (thread from the API, oldest first). */
function useThread(message) {
  return useMemo(() => {
    if (!message) return []
    const list = Array.isArray(message.thread) && message.thread.length ? [...message.thread] : []
    if (!list.some(t => t.id === message.id)) list.push(message)
    return list.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
  }, [message])
}

export default function Reader({
  message, loading, error, onRetry,
  accountsById, folders, showAccount,
  onBack, onPrev, onNext, hasPrev, hasNext,
  onAction, onMessageAction, onReply, onEditDraft, onMailto,
  className,
}) {
  const thread = useThread(message)
  const [fullById, setFullById] = useState({})
  const [expanded, setExpanded] = useState(() => new Set())
  const [loadingIds, setLoadingIds] = useState(() => new Set())
  const [errors, setErrors] = useState({})
  const [showAll, setShowAll] = useState(false)
  const scrollRef = useRef(null)
  const openedId = message?.id

  // New conversation → reset; same conversation refetched → merge.
  const lastId = useRef(null)
  useEffect(() => {
    if (!message) { lastId.current = null; return }
    if (lastId.current !== message.id) {
      lastId.current = message.id
      setFullById({ [message.id]: message })
      setExpanded(new Set([message.id]))
      setErrors({})
      setShowAll(false)
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    } else {
      // Same message, new state from the mailbox (star, read…): keep the loaded body (e.g. images shown).
      const { flagged, seen, folderId, folderRole } = message
      setFullById(prev => ({ ...prev, [message.id]: { ...(prev[message.id] || message), flagged, seen, folderId, folderRole } }))
    }
  }, [message])

  const fetchFull = useCallback(async (id, opts = {}) => {
    setLoadingIds(s => new Set(s).add(id))
    setErrors(e => ({ ...e, [id]: null }))
    try {
      const data = await mailApi.message(id, { peek: true, ...opts })
      setFullById(prev => ({ ...prev, [id]: data }))
    } catch (err) {
      setErrors(e => ({ ...e, [id]: err.message }))
    } finally {
      setLoadingIds(s => { const n = new Set(s); n.delete(id); return n })
    }
  }, [])

  function toggle(id) {
    const willExpand = !expanded.has(id)
    setExpanded(prev => {
      const next = new Set(prev)
      if (willExpand) next.add(id)
      else next.delete(id)
      return next
    })
    if (willExpand && !fullById[id] && !loadingIds.has(id)) fetchFull(id)
  }

  function showImages(full) {
    fetchFull(full.id, { images: true })
  }

  function starOne(m) {
    const flagged = !(fullById[m.id]?.flagged ?? m.flagged)
    setFullById(prev => (prev[m.id] ? { ...prev, [m.id]: { ...prev[m.id], flagged } } : prev))
    onMessageAction?.(m.id, flagged ? 'star' : 'unstar')
  }

  function print(full) {
    const ok = printMessage({
      subject: full.subject,
      from: formatAddress(full.from),
      to: (full.to || []).map(formatAddress).join(', '),
      date: formatFullDate(full.date),
      html: full.html || (full.text ? `<pre>${full.text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>` : ''),
    })
    if (!ok) toast.error('Allow pop-ups to print')
  }

  if (!message) {
    return (
      <section className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white', className)} aria-label="Reader">
        {loading ? (
          <>
            <div className="flex h-12 shrink-0 items-center border-b border-gray-200/80 px-3">
              <IconButton label="Back" onClick={onBack} className="lg:hidden"><ArrowLeft /></IconButton>
            </div>
            <ReaderSkeleton />
          </>
        ) : error ? (
          <div className="flex flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center border-b border-gray-200/80 px-3 lg:hidden">
              <IconButton label="Back" onClick={onBack}><ArrowLeft /></IconButton>
            </div>
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon={Mail} title="Couldn't open message" description={error} action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>} />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={Mail} title="Select a message" />
          </div>
        )}
      </section>
    )
  }

  const opened = fullById[openedId] || message
  const role = opened.folderRole
  const account = accountsById[opened.accountId]
  const isDraft = opened.draft || role === 'DRAFTS'
  const folder = folders?.find(f => f.id === opened.folderId)
  const folderLabel = role === 'CUSTOM' ? folder?.name || 'Folder' : roleLabel(role)

  // Long threads: first, "n more", last two (the opened one always visible).
  let visible = thread.map(t => ({ type: 'msg', item: t }))
  if (!showAll && thread.length >= 5) {
    const idx = thread.findIndex(t => t.id === openedId)
    const tail = Math.min(idx >= 0 ? idx : thread.length - 2, thread.length - 2)
    const hidden = tail - 1
    if (hidden >= 2) {
      visible = [
        { type: 'msg', item: thread[0] },
        { type: 'more', count: hidden },
        ...thread.slice(tail).map(t => ({ type: 'msg', item: t })),
      ]
    }
  }

  const act = (action, opts) => () => onAction(action, opts)
  const replyTarget = [...thread].reverse().map(t => fullById[t.id]).find(f => f && !(f.draft || f.folderRole === 'DRAFTS')) || opened
  const canReplyAll = replyAllPossible(replyTarget, account?.email)

  return (
    <section className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white', className)} aria-label="Reader">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-gray-200/80 px-2 sm:px-3">
        <IconButton label="Back" shortcut="U" onClick={onBack} className="lg:hidden"><ArrowLeft /></IconButton>
        {role === 'TRASH' ? (
          <>
            <IconButton label="Restore" onClick={act('restore')}><ArchiveRestore /></IconButton>
            <IconButton label="Delete forever" onClick={act('delete')} className="hover:text-red-600"><Trash2 /></IconButton>
          </>
        ) : (
          <>
            {role === 'ARCHIVE' ? (
              <IconButton label="Move to inbox" onClick={act('restore')}><Inbox /></IconButton>
            ) : !isDraft && role !== 'SPAM' && (
              <IconButton label="Archive" shortcut="E" onClick={act('archive')}><Archive /></IconButton>
            )}
            {role === 'SPAM' ? (
              <IconButton label="Not spam" onClick={act('notSpam')}><ShieldCheck /></IconButton>
            ) : !isDraft && role !== 'SENT' && (
              <IconButton label="Report spam" shortcut="!" onClick={act('spam')}><OctagonAlert /></IconButton>
            )}
            <IconButton label="Delete" shortcut="#" onClick={act('trash')}><Trash2 /></IconButton>
          </>
        )}
        <MoveToMenu
          folders={folders}
          excludeRoles={[role]}
          excludeFolderIds={[opened.folderId]}
          onSelect={(t) => onAction(t.action, { folderId: t.folderId, label: t.label })}
        >
          <IconButton label="Move to"><FolderInput /></IconButton>
        </MoveToMenu>
        <span className="mx-1 h-4 w-px bg-gray-200" />
        {!isDraft && <IconButton label="Mark as unread" shortcut="⇧U" onClick={act('unread')}><Mail /></IconButton>}
        {!isDraft && (
          <IconButton
            label={opened.flagged ? 'Remove star' : 'Star'}
            shortcut="S"
            onClick={() => starOne(opened)}
            className={cn(opened.flagged && 'text-amber-500 hover:text-amber-600')}
          >
            <Star className={cn(opened.flagged && 'fill-amber-400')} />
          </IconButton>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Newer" shortcut="K" onClick={onPrev} disabled={!hasPrev} className="hidden sm:inline-flex"><ChevronUp /></IconButton>
          <IconButton label="Older" shortcut="J" onClick={onNext} disabled={!hasNext} className="hidden sm:inline-flex"><ChevronDown /></IconButton>
          <ActionMenu
            items={[
              { label: 'Print', icon: Printer, onClick: () => print(opened) },
              { label: 'Show original', icon: Code, onClick: () => window.open(mailApi.rawUrl(opened.id, true), '_blank', 'noopener') },
              { label: 'Download .eml', icon: Download, onClick: () => downloadFile(mailApi.rawUrl(opened.id)) },
            ]}
          />
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-4xl px-3 pb-10 pt-5 sm:px-6">
          <div className="px-1">
            <h1 className="break-words text-lg font-semibold leading-snug tracking-tight text-gray-900">
              {opened.subject || '(no subject)'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{folderLabel}</Badge>
              {showAccount && account && (
                <Badge variant="outline">
                  <AccountDot color={account.color} className="size-1.5" />
                  {account.name}
                </Badge>
              )}
              {opened.priority === 'high' && <Badge variant="danger">High priority</Badge>}
              {thread.length > 1 && <span className="text-xs tabular-nums text-muted-foreground">{thread.length} messages</span>}
              {isDraft && (
                <Button size="xs" variant="outline" className="ml-auto" onClick={() => onEditDraft(opened)}>
                  <Pencil />
                  Edit draft
                </Button>
              )}
            </div>
          </div>

          <div className="mt-5 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-xs">
            {visible.map((v) => v.type === 'more' ? (
              <button
                key="__more"
                type="button"
                onClick={() => setShowAll(true)}
                className="relative flex w-full items-center justify-center py-2 outline-none hover:bg-gray-50 focus-visible:bg-gray-50"
              >
                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs font-medium tabular-nums text-gray-600 shadow-xs">
                  {v.count} more
                </span>
              </button>
            ) : (
              <ThreadMessage
                key={v.item.id}
                item={v.item}
                full={fullById[v.item.id]}
                expanded={expanded.has(v.item.id)}
                loading={loadingIds.has(v.item.id)}
                error={errors[v.item.id]}
                collapsible={thread.length > 1}
                account={accountsById[v.item.accountId] || account}
                onToggle={() => toggle(v.item.id)}
                onStar={starOne}
                onReply={onReply}
                onShowImages={showImages}
                onMailto={onMailto}
                onPrint={print}
                onEditDraft={onEditDraft}
                rawUrl={mailApi.rawUrl(v.item.id, true)}
                downloadUrl={mailApi.rawUrl(v.item.id)}
              />
            ))}
          </div>

          {!isDraft && (
            <div className="mt-4 flex flex-wrap gap-2 px-1">
              <Button variant="outline" size="sm" onClick={() => onReply('reply', replyTarget)}>
                <Reply />
                Reply
              </Button>
              {canReplyAll && (
                <Button variant="outline" size="sm" onClick={() => onReply('replyAll', replyTarget)}>
                  <ReplyAll />
                  Reply all
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onReply('forward', replyTarget)}>
                <Forward />
                Forward
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
