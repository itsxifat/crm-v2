'use client'

import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  BadgeCheck, Building2, ChevronDown, Code, Download, Forward, ImageOff, MoreHorizontal, Paperclip, Pencil, Printer, Reply, ReplyAll, Star, Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import AttachmentGrid from './AttachmentGrid'
import EmailFrame from './EmailFrame'
import {
  displayName, formatAddress, formatFullDate, formatHeaderDate, formatRelative, parseUnsubscribe, sameAddress, shortName,
} from './mailUtils'
import { IconButton, MailAvatar, Skeleton, menuContent, menuItem, menuSeparator } from './ui'

const CRM_META = {
  client: { label: 'Client', icon: Building2 },
  lead:   { label: 'Lead',   icon: Target },
  staff:  { label: 'Staff',  icon: BadgeCheck },
}

function CrmChip({ crm }) {
  const meta = CRM_META[crm.type] || { label: 'Contact', icon: BadgeCheck }
  const Icon = meta.icon
  const text = `${meta.label} · ${crm.label || crm.name || ''}`
  const cls = 'inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-500/10 transition-colors'
  if (!crm.href) return <span className={cls}><Icon className="size-3 shrink-0" /><span className="truncate">{text}</span></span>
  return (
    <Link href={crm.href} className={cn(cls, 'hover:bg-gray-200/70 hover:text-gray-900')} onClick={(e) => e.stopPropagation()}>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </Link>
  )
}

function recipientSummary(m, myEmail) {
  const fmt = (a) => (sameAddress(a.address, myEmail) ? 'me' : shortName(a))
  const list = (arr, max) => {
    const names = (arr || []).map(fmt)
    return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ')
  }
  let s = m.to?.length ? `to ${list(m.to, 3)}` : 'to undisclosed recipients'
  if (m.cc?.length) s += `, cc ${list(m.cc, 2)}`
  if (m.bcc?.length) s += `, bcc ${list(m.bcc, 2)}`
  return s
}

function DetailRow({ label, children }) {
  if (!children || (Array.isArray(children) && !children.length)) return null
  return (
    <>
      <dt className="text-right text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-gray-900">{children}</dd>
    </>
  )
}

function DetailsPopover({ m, account }) {
  const join = (arr) => (arr || []).map(formatAddress).join(', ')
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className="inline-flex max-w-full items-center gap-0.5 rounded text-xs text-muted-foreground outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{recipientSummary(m, account?.email)}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className={cn(menuContent, 'w-[min(380px,calc(100vw-2rem))] p-3')}>
          <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-xs">
            <DetailRow label="From">{formatAddress(m.from)}</DetailRow>
            <DetailRow label="Reply to">{join(m.replyTo)}</DetailRow>
            <DetailRow label="To">{join(m.to)}</DetailRow>
            <DetailRow label="Cc">{join(m.cc)}</DetailRow>
            <DetailRow label="Bcc">{join(m.bcc)}</DetailRow>
            <DetailRow label="Date">{formatFullDate(m.date)}</DetailRow>
            <DetailRow label="Subject">{m.subject || '(no subject)'}</DetailRow>
            <DetailRow label="Mailbox">{account ? `${account.name} · ${account.email}` : null}</DetailRow>
          </dl>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MessageMenu({ onReply, onForward, onReplyAll, onPrint, rawUrl, downloadUrl, canReplyAll }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="More" onClick={(e) => e.stopPropagation()}><MoreHorizontal /></IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={menuContent}>
          <DropdownMenu.Item className={menuItem} onSelect={onReply}><Reply className="size-4 text-gray-500" />Reply</DropdownMenu.Item>
          {canReplyAll && <DropdownMenu.Item className={menuItem} onSelect={onReplyAll}><ReplyAll className="size-4 text-gray-500" />Reply all</DropdownMenu.Item>}
          <DropdownMenu.Item className={menuItem} onSelect={onForward}><Forward className="size-4 text-gray-500" />Forward</DropdownMenu.Item>
          <DropdownMenu.Separator className={menuSeparator} />
          <DropdownMenu.Item className={menuItem} onSelect={onPrint}><Printer className="size-4 text-gray-500" />Print</DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => window.open(rawUrl, '_blank', 'noopener')}><Code className="size-4 text-gray-500" />Show original</DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href={downloadUrl} download className={menuItem}><Download className="size-4 text-gray-500" />Download .eml</a>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function replyAllPossible(m, myEmail) {
  const others = [...(m.to || []), ...(m.cc || [])].filter(a => !sameAddress(a.address, myEmail))
  return others.length + (sameAddress(m.from?.address, myEmail) ? 0 : 1) > 1
}

function BodySkeleton() {
  return (
    <div className="space-y-2.5 py-1" aria-hidden>
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-9/12" />
      <Skeleton className="h-3 w-2/5" />
    </div>
  )
}

/**
 * One message of a conversation. Collapsed: a one-line summary (list data).
 * Expanded: full header, body, attachments (needs `full` from GET /messages/:id).
 */
export default function ThreadMessage({
  item, full, expanded, loading, error, collapsible, account,
  onToggle, onStar, onReply, onShowImages, onMailto, onPrint, onEditDraft, rawUrl, downloadUrl,
}) {
  const m = full || item
  const name = displayName(m.from) || '(unknown sender)'
  const isDraft = m.draft || m.folderRole === 'DRAFTS'

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 sm:px-5"
      >
        <MailAvatar addr={m.from} />
        <span className={cn('w-28 shrink-0 truncate text-sm sm:w-40', !m.seen ? 'font-semibold text-gray-900' : 'font-medium text-gray-700')}>
          {isDraft ? <span className="text-red-600">Draft</span> : name}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-500">{m.snippet}</span>
        {m.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-gray-400" />}
        <time dateTime={m.date || undefined} title={formatFullDate(m.date)} className="shrink-0 text-xs tabular-nums text-gray-500">
          {formatHeaderDate(m.date)}
        </time>
      </button>
    )
  }

  const unsubscribe = parseUnsubscribe(full?.listUnsubscribe)
  const canReplyAll = replyAllPossible(m, account?.email)

  return (
    <article className="px-4 py-4 sm:px-5">
      <header
        className={cn('flex items-start gap-3', collapsible && 'cursor-pointer')}
        onClick={collapsible ? onToggle : undefined}
      >
        <MailAvatar addr={m.from} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="truncate text-sm font-semibold text-gray-900">{name}</span>
            {m.from?.address && m.from.address !== name && (
              <span className="truncate text-xs text-muted-foreground">&lt;{m.from.address}&gt;</span>
            )}
            {full?.crm && <CrmChip crm={full.crm} />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            {full ? <DetailsPopover m={full} account={account} /> : <span className="text-xs text-muted-foreground">{recipientSummary(m, account?.email)}</span>}
            {unsubscribe && (
              <a
                href={unsubscribe}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-gray-900 hover:underline"
              >
                Unsubscribe
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <time
            dateTime={m.date || undefined}
            title={formatFullDate(m.date)}
            className="mr-1 hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:inline"
          >
            {formatHeaderDate(m.date)}
            <span className="hidden text-gray-400 xl:inline"> ({formatRelative(m.date)})</span>
          </time>
          {isDraft ? (
            <IconButton label="Edit draft" onClick={() => full && onEditDraft?.(full)} disabled={!full}><Pencil /></IconButton>
          ) : (
            <>
              <IconButton label={m.flagged ? 'Remove star' : 'Star'} onClick={() => onStar?.(m)} className={cn(m.flagged && 'text-amber-500 hover:text-amber-600')}>
                <Star className={cn(m.flagged && 'fill-amber-400')} />
              </IconButton>
              <IconButton label="Reply" shortcut="R" onClick={() => full && onReply('reply', full)} disabled={!full}><Reply /></IconButton>
              {full && (
                <MessageMenu
                  canReplyAll={canReplyAll}
                  onReply={() => onReply('reply', full)}
                  onReplyAll={() => onReply('replyAll', full)}
                  onForward={() => onReply('forward', full)}
                  onPrint={() => onPrint?.(full)}
                  rawUrl={rawUrl}
                  downloadUrl={downloadUrl}
                />
              )}
            </>
          )}
        </div>
      </header>

      <div className="mt-3 sm:pl-12">
        {full?.remoteBlocked && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-gray-200/80 bg-gray-50/80 px-3 py-2 text-xs text-gray-600">
            <ImageOff className="size-4 shrink-0 text-gray-400" />
            <span>Images hidden</span>
            <button
              type="button"
              onClick={() => onShowImages?.(full)}
              className="ml-auto rounded font-medium text-gray-900 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Show images
            </button>
          </div>
        )}

        {loading && !full ? (
          <BodySkeleton />
        ) : error && !full ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : full?.html ? (
          <EmailFrame html={full.html} onMailto={onMailto} title={full.subject || 'Message body'} />
        ) : full?.text ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-900">{full.text}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">{m.snippet || 'No content'}</p>
        )}

        {full && <AttachmentGrid attachments={full.attachments} />}
      </div>
    </article>
  )
}
