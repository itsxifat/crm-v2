import { format, isThisYear, isToday, isTomorrow, isYesterday, formatDistanceToNowStrict } from 'date-fns'
import {
  Archive, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo,
  Inbox, OctagonAlert, Send, Star, Clock, Trash2, Folder,
} from 'lucide-react'

// ─── Folders / views ──────────────────────────────────────────────────────────

export const ROLE_META = {
  INBOX:   { label: 'Inbox',   icon: Inbox },
  SENT:    { label: 'Sent',    icon: Send },
  DRAFTS:  { label: 'Drafts',  icon: FileText },
  ARCHIVE: { label: 'Archive', icon: Archive },
  SPAM:    { label: 'Spam',    icon: OctagonAlert },
  TRASH:   { label: 'Trash',   icon: Trash2 },
  CUSTOM:  { label: 'Folder',  icon: Folder },
}

export const VIEW_META = {
  starred:     { label: 'Starred',     icon: Star },
  scheduled:   { label: 'Scheduled',   icon: Clock },
  unread:      { label: 'Unread',      icon: Inbox },
  attachments: { label: 'Attachments', icon: File },
}

export function roleLabel(role) {
  return ROLE_META[role]?.label ?? 'Folder'
}

function comparePaths(a, b) {
  const sa = String(a.path).toLowerCase().split(a.delimiter || '/')
  const sb = String(b.path).toLowerCase().split(b.delimiter || '/')
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1
  }
  return sa.length - sb.length
}

/** CUSTOM folders in tree order, each with `level` = number of custom ancestors (for indentation). */
export function customFolderTree(folders = []) {
  const custom = folders.filter(f => f.role === 'CUSTOM')
  const byPath = new Map(custom.map(f => [f.path, f]))
  const level = (f) => {
    let n = 0
    let p = f.parentPath
    const seen = new Set()
    while (p && byPath.has(p) && !seen.has(p)) {
      seen.add(p)
      n++
      p = byPath.get(p).parentPath
    }
    return n
  }
  return custom.slice().sort(comparePaths).map(f => ({ ...f, level: level(f) }))
}

// ─── Dates ────────────────────────────────────────────────────────────────────

export function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** List column: today → time, this year → "Oct 3", older → dd/mm/yy. */
export function formatListDate(v) {
  const d = toDate(v)
  if (!d) return ''
  if (isToday(d)) return format(d, 'h:mm a')
  if (isThisYear(d)) return format(d, 'MMM d')
  return format(d, 'dd/MM/yy')
}

export function formatFullDate(v) {
  const d = toDate(v)
  return d ? format(d, 'EEE, MMM d, yyyy, h:mm a') : ''
}

/** Reader header: "Oct 3, 2:14 PM" this year, else with the year. */
export function formatHeaderDate(v) {
  const d = toDate(v)
  if (!d) return ''
  if (isToday(d)) return format(d, 'h:mm a')
  return isThisYear(d) ? format(d, 'MMM d, h:mm a') : format(d, 'MMM d, yyyy, h:mm a')
}

export function formatRelative(v) {
  const d = toDate(v)
  if (!d) return ''
  if (Date.now() - d.getTime() < 60_000) return 'just now'
  return formatDistanceToNowStrict(d, { addSuffix: true })
}

/** Compact "2m ago" for the sync indicator. */
export function formatAgo(v) {
  const d = toDate(v)
  if (!d) return null
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function formatSendAt(v) {
  const d = toDate(v)
  if (!d) return ''
  if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`
  if (isTomorrow(d)) return `Tomorrow, ${format(d, 'h:mm a')}`
  if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`
  return format(d, isThisYear(d) ? 'EEE, MMM d, h:mm a' : 'MMM d, yyyy, h:mm a')
}

// ─── People ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-pink-100 text-pink-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
  'bg-lime-100 text-lime-800',
]

export function avatarColor(seed = '') {
  const s = String(seed).toLowerCase()
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function initialsOf(addr) {
  const name = (addr?.name || '').replace(/["'()<>[\]]/g, '').trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] || ''
    const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
    return (first + last).toUpperCase() || '?'
  }
  const local = (addr?.address || '').split('@')[0] || ''
  return (local[0] || '?').toUpperCase()
}

export function displayName(addr) {
  if (!addr) return ''
  return addr.name?.trim() || addr.address || ''
}

/** First name (or address local part) — used in compact recipient lists. */
export function shortName(addr) {
  if (!addr) return ''
  const name = addr.name?.trim()
  if (name) return name.split(/\s+/)[0]
  return (addr.address || '').split('@')[0]
}

export function formatAddress(addr) {
  if (!addr) return ''
  const name = addr.name?.trim()
  return name && name.toLowerCase() !== addr.address ? `${name} <${addr.address}>` : addr.address
}

export function sameAddress(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()
}

// ─── Files ────────────────────────────────────────────────────────────────────

export function formatBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(v < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(v / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function isPreviewableImage(contentType = '') {
  const t = String(contentType).toLowerCase()
  return t.startsWith('image/') && !t.includes('svg')
}

export function isPdf(contentType = '', filename = '') {
  return String(contentType).toLowerCase() === 'application/pdf' || /\.pdf$/i.test(filename)
}

export function fileIcon(contentType = '', filename = '') {
  const t = String(contentType).toLowerCase()
  const ext = (String(filename).split('.').pop() || '').toLowerCase()
  if (t.startsWith('image/')) return FileImage
  if (t.startsWith('video/')) return FileVideo
  if (t.startsWith('audio/')) return FileAudio
  if (/zip|rar|7z|tar|gzip|compressed/.test(t) || ['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return FileArchive
  if (/sheet|excel|csv/.test(t) || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet
  if (/json|xml|javascript|html/.test(t) || ['js', 'json', 'xml', 'html', 'css'].includes(ext)) return FileCode
  if (t.startsWith('text/') || /pdf|word|document|presentation|powerpoint/.test(t)) return FileText
  return File
}

export function fileExt(filename = '') {
  const parts = String(filename).split('.')
  return parts.length > 1 ? parts.pop().slice(0, 4).toUpperCase() : ''
}

// ─── Headers ──────────────────────────────────────────────────────────────────

/** List-Unsubscribe: prefer the https endpoint, fall back to mailto. */
export function parseUnsubscribe(header) {
  if (!header) return null
  const urls = [...String(header).matchAll(/<([^>]+)>/g)].map(m => m[1].trim())
  if (!urls.length) urls.push(String(header).trim())
  return urls.find(u => /^https:\/\//i.test(u)) || urls.find(u => /^mailto:/i.test(u)) || null
}

/** mailto: link → composer prefill { to, subject, html }. */
export function parseMailto(href) {
  try {
    const u = new URL(href)
    if (u.protocol !== 'mailto:') return null
    const to = decodeURIComponent(u.pathname || '')
      .split(',').map(s => s.trim()).filter(Boolean)
      .map(address => ({ name: '', address }))
    const subject = u.searchParams.get('subject') || ''
    const body = u.searchParams.get('body') || ''
    const html = body
      ? body.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\r?\n/g, '<br>')
      : undefined
    return { to, subject, html }
  } catch {
    return null
  }
}

// ─── Search / cursor ──────────────────────────────────────────────────────────

export const FILTER_CHIPS = [
  { key: 'unread',      label: 'Unread',      op: 'is:unread' },
  { key: 'starred',     label: 'Starred',     op: 'is:starred' },
  { key: 'attachments', label: 'Attachments', op: 'has:attachment' },
]

export const SEARCH_OPERATORS = [
  { op: 'from:',           hint: 'Sender' },
  { op: 'to:',             hint: 'Recipient' },
  { op: 'subject:',        hint: 'Subject' },
  { op: 'has:attachment',  hint: 'With files' },
  { op: 'is:unread',       hint: 'Unread' },
  { op: 'is:starred',      hint: 'Starred' },
  { op: 'before:',         hint: 'YYYY-MM-DD' },
  { op: 'after:',          hint: 'YYYY-MM-DD' },
  { op: 'larger:',         hint: 'e.g. 5M' },
  { op: 'in:',             hint: 'inbox, sent, trash…' },
]

/** The search text plus the active filter chips, as one operator query. */
export function buildQuery(q, chips) {
  const parts = [String(q || '').trim()]
  for (const c of FILTER_CHIPS) if (chips?.[c.key]) parts.push(c.op)
  return parts.filter(Boolean).join(' ')
}

export function hasInOperator(q) {
  return /(^|\s)in:\S+/i.test(String(q || ''))
}

/** Same cursor format as the API (base64url of `${dateISO}_${id}`), for continuing past the last row. */
export function cursorFor(item) {
  if (!item?.id) return null
  const raw = `${item.date || 'null'}_${item.id}`
  const b64 = typeof window !== 'undefined' ? window.btoa(raw) : raw
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

/** dataTransfer type for dragging message rows onto rail folders. */
export const DRAG_TYPE = 'application/x-crm-mail-ids'

export function isTypingTarget(el) {
  if (!el || el === document.body) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

export function formatCount(n) {
  return new Intl.NumberFormat('en-US').format(Number(n) || 0)
}
