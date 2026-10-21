'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import * as Tooltip from '@radix-ui/react-tooltip'
import toast from 'react-hot-toast'
import { useComposer } from '@/components/mail/composer/ComposerProvider'
import Button from '@/components/ui/Button'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { canDo } from '@/lib/rbac'
import { cn } from '@/lib/utils'
import FolderRail from './FolderRail'
import MessageList, { ListSkeleton } from './MessageList'
import Reader from './Reader'
import ScheduledList from './ScheduledList'
import ShortcutsDialog from './ShortcutsDialog'
import { mailApi } from './mailApi'
import {
  DRAG_TYPE, ROLE_META, VIEW_META, buildQuery, cursorFor, displayName, hasInOperator, isTypingTarget, parseMailto, plural,
} from './mailUtils'
import { Skeleton } from './ui'

const PAGE_SIZE = 50
const VIEWS = ['starred', 'unread', 'attachments', 'scheduled']
const MOVE_ACTIONS = new Set(['archive', 'trash', 'spam', 'notSpam', 'restore', 'move', 'delete'])
const UNDOABLE = new Set(['archive', 'trash', 'spam', 'notSpam', 'restore', 'move'])
// Conversation rows act on every message of the thread in the row's folder (Gmail semantics).
const THREAD_WIDE = new Set(['read', 'unread', 'archive', 'trash', 'spam', 'notSpam', 'restore', 'move', 'delete'])
const TARGET_ROLE = { archive: 'ARCHIVE', trash: 'TRASH', spam: 'SPAM', notSpam: 'INBOX', restore: 'INBOX' }
const DONE_TEXT = {
  archive: 'archived', trash: 'moved to Trash', spam: 'marked as spam',
  notSpam: 'moved to Inbox', restore: 'moved to Inbox', delete: 'deleted forever',
}
const THREADS_KEY = 'mail:threads'
const RAIL_KEY = 'mail:rail-hidden'
const POLL_VISIBLE = 10_000
const POLL_HIDDEN = 30_000
const NO_CHIPS = Object.freeze({})

const isDraftItem = (i) => !!i && (i.draft || i.folderRole === 'DRAFTS')
const time = (i) => new Date(i?.date || 0).getTime()
const byDateDesc = (a, b) => (time(b) - time(a)) || (a.id < b.id ? 1 : -1)
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

function readPref(key) {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function writePref(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0') } catch {}
}

function useMediaQuery(query) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

async function mapLimit(list, limit, fn) {
  const out = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const k = next++
      out[k] = await fn(list[k])
    }
  })
  await Promise.all(workers)
  return out
}

/** Silent refresh: swap in the fresh first page but keep rows already paged in below it. */
function mergeRefresh(prev, page, meta) {
  const base = { ...prev, loading: false, error: null, total: meta.total ?? prev.total }
  if (!meta.nextCursor || prev.items.length <= page.length) {
    return { ...base, items: page, total: meta.total ?? page.length, nextCursor: meta.nextCursor ?? null, hasMoreRemote: !!meta.hasMoreRemote }
  }
  const last = page[page.length - 1]
  const ids = new Set(page.map(i => i.id))
  const tail = prev.items.filter(i => !ids.has(i.id) && byDateDesc(last, i) < 0)
  return { ...base, items: [...page, ...tail] }
}

function showUndoToast(message, onUndo) {
  toast((t) => (
    <span className="flex items-center gap-4">
      <span>{message}</span>
      <button
        type="button"
        onClick={() => { toast.dismiss(t.id); onUndo() }}
        className="-my-1 rounded-md px-1.5 py-1 text-sm font-semibold text-gray-900 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Undo
      </button>
    </span>
  ), { duration: 6000 })
}

export function MailboxSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden" aria-hidden>
      <div className="hidden w-60 shrink-0 flex-col gap-2 border-r border-gray-200/80 bg-gray-50/40 p-2 xl:flex">
        <div className="flex items-center gap-2.5 p-1.5">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-24" /><Skeleton className="h-2.5 w-32" /></div>
        </div>
        <Skeleton className="h-9 rounded-lg" />
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 rounded-lg" />)}
        </div>
      </div>
      <div className="flex w-full flex-col border-gray-200/80 lg:w-[360px] lg:border-r xl:w-[380px] 2xl:w-[420px]">
        <div className="flex h-12 items-center gap-3 border-b border-gray-200/80 px-3"><Skeleton className="h-4 w-20" /></div>
        <div className="space-y-2 border-b border-gray-200/80 px-3 pb-2 pt-2.5">
          <Skeleton className="h-9 rounded-lg" />
          <div className="flex gap-1.5"><Skeleton className="h-7 w-20 rounded-full" /><Skeleton className="h-7 w-20 rounded-full" /><Skeleton className="h-7 w-24 rounded-full" /></div>
        </div>
        <ListSkeleton />
      </div>
      <div className="hidden flex-1 lg:block" />
    </div>
  )
}

export default function Mailbox({ accounts, bridge }) {
  const { data: session } = useSession()
  const canManage = canDo(session, 'mail.manage')
  const composer = useComposer()
  const composerRef = useRef(composer)
  composerRef.current = composer
  const sp = useSearchParams()
  const isLg = useMediaQuery('(min-width: 1024px)')
  const isXl = useMediaQuery('(min-width: 1280px)')
  const searchRef = useRef(null)

  // ─── URL state ──────────────────────────────────────────────────────────────
  const accountsById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts])
  const accountParam = sp.get('account')
  const accountId = accounts.length === 1 ? accounts[0].id : (accountParam && accountsById[accountParam] ? accountParam : 'all')
  const folderParam = sp.get('folder')
  const roleParam = sp.get('role')
  const viewParam = sp.get('view')
  const q = sp.get('q') || ''
  const openId = sp.get('m') || null
  const composeParam = sp.get('compose')

  const view = VIEWS.includes(viewParam) ? viewParam : null
  const loc = useMemo(() => (
    view ? { type: 'view', view }
      : folderParam ? { type: 'folder', folderId: folderParam }
        : { type: 'role', role: ROLE_META[roleParam] && roleParam !== 'CUSTOM' ? roleParam : 'INBOX' }
  ), [view, folderParam, roleParam])
  const locKey = `${accountId}|${loc.type}|${loc.view || loc.folderId || loc.role}`

  const setUrl = useCallback((patch, { push = false } = {}) => {
    const next = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (url === `${window.location.pathname}${window.location.search}`) return
    // Shallow: Next 14 syncs useSearchParams with native history calls (no server round trip).
    if (push) window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
  }, [])

  // ─── Folders ────────────────────────────────────────────────────────────────
  const [folders, setFolders] = useState([])
  const [foldersLoaded, setFoldersLoaded] = useState(false)
  const loadFolders = useCallback(async () => {
    try {
      setFolders(await mailApi.folders('all'))
    } catch (err) {
      console.error('[mail] folders', err)
    } finally {
      setFoldersLoaded(true)
    }
  }, [])
  useEffect(() => { loadFolders() }, [loadFolders])

  const folderTimer = useRef(null)
  const scheduleFolders = useCallback((ms = 900) => {
    clearTimeout(folderTimer.current)
    folderTimer.current = setTimeout(loadFolders, ms)
  }, [loadFolders])
  useEffect(() => () => clearTimeout(folderTimer.current), [])

  const adjustUnread = useCallback((deltas) => {
    if (!Object.keys(deltas).length) return
    setFolders(prev => prev.map(f => (deltas[f.id] ? { ...f, unread: Math.max(0, (f.unread || 0) + deltas[f.id]) } : f)))
  }, [])

  const scopeIds = useMemo(() => (accountId === 'all' ? accounts.map(a => a.id) : [accountId]), [accountId, accounts])
  const currentFolder = loc.type === 'folder' ? folders.find(f => f.id === loc.folderId) || null : null
  const locRole = loc.type === 'role' ? loc.role : currentFolder?.role || null
  const singleFolder = currentFolder || (loc.type === 'role' && accountId !== 'all'
    ? folders.find(f => f.accountId === accountId && f.role === loc.role) || null
    : null)
  const activeKey = loc.type === 'view' ? `view:${loc.view}`
    : loc.type === 'role' ? `role:${loc.role}`
      : currentFolder && currentFolder.role !== 'CUSTOM' ? `role:${currentFolder.role}` : `folder:${loc.folderId}`
  const title = loc.type === 'view' ? VIEW_META[loc.view]?.label
    : loc.type === 'role' ? ROLE_META[loc.role]?.label
      : currentFolder ? (currentFolder.role === 'CUSTOM' ? currentFolder.name : ROLE_META[currentFolder.role]?.label) : (foldersLoaded ? 'Folder' : '')

  const unreadByAccount = useMemo(() => {
    const out = {}
    for (const a of accounts) out[a.id] = a.unread || 0
    if (folders.length) {
      for (const a of accounts) out[a.id] = 0
      for (const f of folders) if (f.role === 'INBOX' && out[f.accountId] !== undefined) out[f.accountId] += f.unread || 0
    }
    return out
  }, [accounts, folders])
  const scopeInboxUnread = scopeIds.reduce((s, id) => s + (unreadByAccount[id] || 0), 0)

  // ─── Preferences / chrome ───────────────────────────────────────────────────
  const [threadsPref, setThreadsPref] = useState(() => readPref(THREADS_KEY))
  const threadsDisabled = locRole === 'DRAFTS' || view === 'scheduled'
  const threads = threadsPref && !threadsDisabled
  const threadsRef = useRef(threads)
  threadsRef.current = threads

  const [railHidden, setRailHidden] = useState(() => readPref(RAIL_KEY))
  const [railSheet, setRailSheet] = useState(false)
  const railDocked = isXl && !railHidden
  useEffect(() => { if (railDocked) setRailSheet(false) }, [railDocked])

  const [chipState, setChipState] = useState({ key: locKey, chips: NO_CHIPS })
  const chips = chipState.key === locKey ? chipState.chips : NO_CHIPS
  const toggleChip = useCallback((key) => {
    setChipState(s => {
      const cur = s.key === locKey ? s.chips : NO_CHIPS
      return { key: locKey, chips: { ...cur, [key]: !cur[key] } }
    })
  }, [locKey])

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // ─── Message list ───────────────────────────────────────────────────────────
  const fullQuery = buildQuery(q, chips)
  const listParams = useMemo(() => {
    if (view === 'scheduled') return null
    const p = { accountId, limit: PAGE_SIZE }
    if (loc.type === 'view') p.view = loc.view
    // `in:` picks the folder itself, so don't also pin one.
    else if (!hasInOperator(fullQuery)) {
      if (loc.type === 'folder') p.folderId = loc.folderId
      else p.role = loc.role
    }
    if (fullQuery) p.q = fullQuery
    if (threads) p.threads = 1
    return p
  }, [view, accountId, loc, fullQuery, threads])
  const listKey = listParams ? JSON.stringify(listParams) : null

  const [list, setList] = useState({ items: [], total: 0, nextCursor: null, hasMoreRemote: false, loading: true, error: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const listRef = useRef(list)
  listRef.current = list
  const paramsRef = useRef(listParams)
  paramsRef.current = listParams
  const listSeq = useRef(0)
  const loadingMoreRef = useRef(false)
  const threadCache = useRef(new Map())

  const fetchList = useCallback(async ({ silent = false } = {}) => {
    const params = paramsRef.current
    if (!params) return
    const seq = ++listSeq.current
    if (!silent) {
      threadCache.current.clear()
      setList(l => ({ ...l, loading: true, error: null }))
    }
    try {
      const { data, meta } = await mailApi.messages(params)
      if (seq !== listSeq.current) return
      setList(prev => (silent
        ? mergeRefresh(prev, data, meta)
        : { items: data, total: meta.total ?? data.length, nextCursor: meta.nextCursor ?? null, hasMoreRemote: !!meta.hasMoreRemote, loading: false, error: null }))
    } catch (err) {
      if (seq !== listSeq.current || silent) return
      setList(l => ({ ...l, items: [], loading: false, error: err.message }))
    }
  }, [])

  useEffect(() => { if (listKey) fetchList() }, [listKey, fetchList])

  const loadMore = useCallback(async () => {
    const cur = listRef.current
    if (!cur.nextCursor || cur.loading || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const seq = listSeq.current
    try {
      const { data, meta } = await mailApi.messages({ ...paramsRef.current, cursor: cur.nextCursor })
      if (seq !== listSeq.current) return
      setList(prev => {
        const ids = new Set(prev.items.map(i => i.id))
        return {
          ...prev,
          items: [...prev.items, ...data.filter(i => !ids.has(i.id))],
          nextCursor: meta.nextCursor ?? null,
          hasMoreRemote: !!meta.hasMoreRemote,
          total: meta.total ?? prev.total,
        }
      })
    } catch (err) {
      if (seq === listSeq.current) toast.error(err.message)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [])

  const singleFolderRef = useRef(singleFolder)
  singleFolderRef.current = singleFolder
  const loadOlder = useCallback(async () => {
    const folder = singleFolderRef.current
    if (!folder) return
    setLoadingOlder(true)
    try {
      const r = await mailApi.loadOlder(folder.id)
      if (r.loaded > 0) {
        const last = listRef.current.items[listRef.current.items.length - 1]
        if (!last) {
          await fetchList({ silent: true })
        } else {
          const seq = listSeq.current
          const { data, meta } = await mailApi.messages({ ...paramsRef.current, cursor: cursorFor(last) })
          if (seq === listSeq.current) {
            setList(prev => {
              const ids = new Set(prev.items.map(i => i.id))
              return {
                ...prev,
                items: [...prev.items, ...data.filter(i => !ids.has(i.id))],
                nextCursor: meta.nextCursor ?? null,
                hasMoreRemote: r.hasMore ?? !!meta.hasMoreRemote,
                total: Math.max(meta.total ?? prev.total, prev.total),
              }
            })
          }
        }
      } else {
        setList(prev => ({ ...prev, hasMoreRemote: !!r.hasMore }))
      }
      scheduleFolders()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoadingOlder(false)
    }
  }, [fetchList, scheduleFolders])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([fetchList({ silent: true }), loadFolders()])
    setRefreshing(false)
  }, [fetchList, loadFolders])

  const patchItems = useCallback((ids, patch) => {
    const set = new Set(ids)
    setList(prev => ({
      ...prev,
      items: prev.items.map(i => (set.has(i.id) ? { ...i, ...(typeof patch === 'function' ? patch(i) : patch) } : i)),
    }))
  }, [])
  const removeItems = useCallback((ids) => {
    const set = new Set(ids)
    setList(prev => {
      const items = prev.items.filter(i => !set.has(i.id))
      return { ...prev, items, total: Math.max(0, prev.total - (prev.items.length - items.length)) }
    })
  }, [])

  // ─── Selection / cursor ─────────────────────────────────────────────────────
  const [selected, setSelected] = useState(() => new Set())
  const [cursorId, setCursorId] = useState(null)
  const cursorRef = useRef(cursorId)
  cursorRef.current = cursorId
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const openIdRef = useRef(openId)
  openIdRef.current = openId
  const anchorRef = useRef(null)
  useEffect(() => {
    setSelected(new Set())
    anchorRef.current = null
  }, [listKey])
  useEffect(() => { setCursorId(null) }, [locKey])

  const toggleSelect = useCallback((item, shift) => {
    const items = listRef.current.items
    const anchor = anchorRef.current
    anchorRef.current = item.id
    setSelected(prev => {
      const next = new Set(prev)
      if (shift && anchor && anchor !== item.id) {
        const a = items.findIndex(i => i.id === anchor)
        const b = items.findIndex(i => i.id === item.id)
        if (a >= 0 && b >= 0) {
          const on = !prev.has(item.id)
          for (let k = Math.min(a, b); k <= Math.max(a, b); k++) {
            if (on) next.add(items[k].id)
            else next.delete(items[k].id)
          }
          return next
        }
      }
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }, [])
  const selectAll = useCallback((on) => {
    setSelected(on ? new Set(listRef.current.items.map(i => i.id)) : new Set())
  }, [])
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  // ─── Reader ─────────────────────────────────────────────────────────────────
  const [reader, setReader] = useState({ id: null, data: null, loading: false, error: null })
  const readerRef = useRef(reader)
  readerRef.current = reader
  const readerSeq = useRef(0)

  const markOpened = useCallback((data) => {
    const item = listRef.current.items.find(i => i.id === data.id)
    const deltas = {}
    if (item && !item.seen) deltas[item.folderId] = -1
    patchItems([data.id], (i) => ({ seen: true, ...(i.threadUnread != null ? { threadUnread: 0 } : {}) }))
    if (Array.isArray(data.thread)) threadCache.current.set(data.id, data.thread)
    // Conversation mode reads the whole conversation, like Gmail.
    if (threadsRef.current && Array.isArray(data.thread)) {
      const others = data.thread.filter(t => !t.seen && t.id !== data.id && t.folderRole !== 'TRASH' && t.folderRole !== 'SPAM')
      if (others.length) {
        for (const t of others) deltas[t.folderId] = (deltas[t.folderId] || 0) - 1
        mailApi.act(others.map(t => t.id), 'read').catch(() => {})
      }
    }
    adjustUnread(deltas)
    if (!item || !item.seen) scheduleFolders(2500)
  }, [patchItems, adjustUnread, scheduleFolders])

  const loadReader = useCallback(async (id) => {
    const seq = ++readerSeq.current
    setReader(r => ({ id, data: r.id === id ? r.data : null, loading: true, error: null }))
    try {
      const data = await mailApi.message(id)
      if (seq !== readerSeq.current) return
      setReader({ id, data: { ...data, seen: true }, loading: false, error: null })
      markOpened(data)
    } catch (err) {
      if (seq !== readerSeq.current) return
      setReader({ id, data: null, loading: false, error: err.message })
    }
  }, [markOpened])

  useEffect(() => {
    if (!openId) {
      readerSeq.current++
      setReader({ id: null, data: null, loading: false, error: null })
      return
    }
    if (readerRef.current.id === openId && readerRef.current.data) return
    setCursorId(openId)
    loadReader(openId)
  }, [openId, loadReader])

  const closeReader = useCallback(() => setUrl({ m: null }), [setUrl])

  // ─── Composer ───────────────────────────────────────────────────────────────
  const [notifyPermission, setNotifyPermission] = useState(null)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) setNotifyPermission(Notification.permission)
  }, [])
  const requestNotify = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'default') return
    try { setNotifyPermission(await Notification.requestPermission()) } catch {}
  }, [])

  const defaultAccount = accountId !== 'all' ? accountId : undefined
  const compose = useCallback((extra = {}) => {
    requestNotify()
    composerRef.current?.open({ mode: 'new', accountId: defaultAccount, ...extra })
  }, [defaultAccount, requestNotify])

  const replyWith = useCallback((mode, full) => {
    if (!full) return
    composerRef.current?.open({ mode, accountId: full.accountId, source: full })
  }, [])

  const editDraft = useCallback((full) => {
    composerRef.current?.open({ mode: 'draft', accountId: full.accountId, source: full })
  }, [])

  const openDraftById = useCallback(async (id) => {
    try {
      // images=1: the draft is re-saved from this HTML, so remote images must not be stripped.
      editDraft(await mailApi.message(id, { peek: true, images: true }))
    } catch (err) {
      toast.error(err.message)
    }
  }, [editDraft])

  const onMailto = useCallback((href) => {
    const pre = parseMailto(href)
    if (!pre) return
    compose({ ...pre, accountId: readerRef.current.data?.accountId || defaultAccount })
  }, [compose, defaultAccount])

  // ?compose=1 (command menu "New email") opens a composer once.
  const composeHandled = useRef(false)
  useEffect(() => {
    if (composeParam !== '1') { composeHandled.current = false; return }
    if (composeHandled.current) return
    composeHandled.current = true
    const to = new URLSearchParams(window.location.search).get('to')
    compose(to ? { to: to.split(',').map(a => ({ name: '', address: a.trim() })).filter(a => a.address) } : {})
    setUrl({ compose: null, to: null })
  }, [composeParam, compose, setUrl])

  // ─── Navigation ─────────────────────────────────────────────────────────────
  const openItem = useCallback((item) => {
    if (isDraftItem(item)) { openDraftById(item.id); return }
    setCursorId(item.id)
    const current = openIdRef.current
    if (current === item.id) return
    setUrl({ m: item.id }, { push: !current })
  }, [openDraftById, setUrl])

  const navigate = useCallback((target) => {
    const patch = { folder: null, role: null, view: null, m: null, q: null }
    if (target.view) patch.view = target.view
    else if (target.folderId) patch.folder = target.folderId
    else if (target.role) {
      const f = accountId !== 'all' ? folders.find(x => x.accountId === accountId && x.role === target.role) : null
      if (f) patch.folder = f.id
      else if (target.role !== 'INBOX') patch.role = target.role
    }
    setUrl(patch, { push: true })
    setRailSheet(false)
  }, [accountId, folders, setUrl])

  const changeAccount = useCallback((id) => {
    const patch = { account: id === 'all' ? null : id, folder: null, role: null, m: null }
    if (loc.type !== 'view') {
      const role = locRole && locRole !== 'CUSTOM' ? locRole : 'INBOX'
      const f = id !== 'all' ? folders.find(x => x.accountId === id && x.role === role) : null
      if (f) patch.folder = f.id
      else if (role !== 'INBOX') patch.role = role
    }
    setUrl(patch, { push: true })
    setRailSheet(false)
  }, [loc.type, locRole, folders, setUrl])

  const setSearch = useCallback((value) => setUrl({ q: value || null, m: null }), [setUrl])

  // ─── Actions ────────────────────────────────────────────────────────────────

  /** Rows → message ids (conversation rows expand to their thread within the row's folder) + origin folders. */
  const expandTargets = useCallback(async (rows, action) => {
    const origin = new Map(rows.map(r => [r.id, r.folderId]))
    if (!threadsRef.current || !THREAD_WIDE.has(action)) return origin
    const multi = rows.filter(r => (r.threadCount || 1) > 1)
    await mapLimit(multi, 6, async (r) => {
      let thread = threadCache.current.get(r.id)
      if (!thread) {
        try {
          thread = (await mailApi.message(r.id, { peek: true }))?.thread || []
          threadCache.current.set(r.id, thread)
        } catch { thread = [] }
      }
      for (const m of thread) if (m.folderId === r.folderId && !origin.has(m.id)) origin.set(m.id, m.folderId)
    })
    return origin
  }, [])

  const executeAction = useCallback(async (rows, action, { folderId, label } = {}) => {
    if (!rows.length) return
    const rowIds = rows.map(r => r.id)
    const isMove = MOVE_ACTIONS.has(action)
    const rd = readerRef.current

    // Optimistic UI first; the thread expansion below may need a round trip.
    if (action === 'read' || action === 'unread') {
      const seen = action === 'read'
      const deltas = {}
      for (const r of rows) {
        const unread = r.threadUnread != null ? r.threadUnread : (r.seen ? 0 : 1)
        const d = seen ? -unread : (unread ? 0 : 1)
        if (d) deltas[r.folderId] = (deltas[r.folderId] || 0) + d
      }
      adjustUnread(deltas)
      patchItems(rowIds, (i) => ({ seen, ...(i.threadUnread != null ? { threadUnread: seen ? 0 : Math.max(1, i.threadUnread) } : {}) }))
      if (!seen && rd.id && rowIds.includes(rd.id)) closeReader()
    } else if (action === 'star' || action === 'unstar') {
      const flagged = action === 'star'
      patchItems(rowIds, { flagged })
      if (rd.data && rowIds.includes(rd.data.id)) setReader(r => ({ ...r, data: { ...r.data, flagged } }))
    } else if (isMove) {
      const p = paramsRef.current
      const stays = p?.view && p.view !== 'unread' && ['archive', 'move', 'restore'].includes(action)
      if (stays) {
        patchItems(rowIds, { folderRole: action === 'move' ? 'CUSTOM' : TARGET_ROLE[action], ...(folderId ? { folderId } : {}) })
      } else {
        const items = listRef.current.items
        const openRow = rd.id && rowIds.includes(rd.id)
        const anchorId = openRow ? rd.id : cursorRef.current
        if (anchorId && rowIds.includes(anchorId)) {
          const idx = items.findIndex(i => i.id === anchorId)
          const rest = items.filter(i => !rowIds.includes(i.id))
          const after = items.slice(idx + 1).find(i => !rowIds.includes(i.id))
          setCursorId((after || rest[rest.length - 1])?.id || null)
        }
        removeItems(rowIds)
        const deltas = {}
        for (const r of rows) {
          const unread = r.threadUnread != null ? r.threadUnread : (r.seen ? 0 : 1)
          if (unread) deltas[r.folderId] = (deltas[r.folderId] || 0) - unread
        }
        adjustUnread(deltas)
        if (openRow) closeReader()
      }
      setSelected(prev => (prev.size ? new Set([...prev].filter(id => !rowIds.includes(id))) : prev))
    }

    try {
      const origin = await expandTargets(rows, action)
      const ids = [...origin.keys()]
      const res = await mailApi.act(ids, action, folderId)
      const failed = res?.failed?.length || 0
      if (failed) {
        toast.error(failed === ids.length ? (res.failed[0]?.error || 'Action failed') : `${plural(failed, 'message')} couldn't be updated`)
        fetchList({ silent: true })
      } else if (UNDOABLE.has(action)) {
        const verb = action === 'move' ? `moved to ${label || 'folder'}` : DONE_TEXT[action]
        const n = rows.length
        const text = n === 1 ? capitalize(verb) : `${plural(n, threadsRef.current ? 'conversation' : 'message')} ${verb}`
        showUndoToast(text, async () => {
          // Inverse: move every message back to the folder it came from.
          const groups = new Map()
          for (const [id, from] of origin) {
            if (!from) continue
            if (!groups.has(from)) groups.set(from, [])
            groups.get(from).push(id)
          }
          try {
            const results = await Promise.all([...groups].map(([fid, list]) => mailApi.act(list, 'move', fid)))
            if (results.some(r => r?.failed?.length)) toast.error("Couldn't undo everything")
          } catch (err) {
            toast.error(err.message)
          }
          fetchList({ silent: true })
          scheduleFolders(300)
        })
      } else if (action === 'delete') {
        toast.success(rows.length === 1 ? 'Deleted forever' : `${plural(rows.length, 'message')} deleted forever`)
      }
    } catch (err) {
      toast.error(err.message)
      fetchList({ silent: true })
    }
    scheduleFolders()
  }, [adjustUnread, patchItems, removeItems, closeReader, expandTargets, fetchList, scheduleFolders])

  /** Entry point for every UI action: confirms permanent deletes, maps Trash→delete inside Trash. */
  const runAction = useCallback((rows, action, opts = {}) => {
    const list = rows.filter(Boolean)
    if (!list.length) return
    let act = action
    if (act === 'trash' && list.every(r => r.folderRole === 'TRASH')) act = 'delete'
    if (act === 'delete') { setConfirmDelete({ rows: list }); return }
    executeAction(list, act, opts)
  }, [executeAction])

  const onQuick = useCallback((item, action) => runAction([item], action), [runAction])
  const onStar = useCallback((item) => runAction([item], item.flagged ? 'unstar' : 'star'), [runAction])

  const selectedItems = useMemo(() => list.items.filter(i => selected.has(i.id)), [list.items, selected])
  // Moved rows drop out of the selection inside executeAction; a cancelled delete keeps it.
  const onBulkAction = useCallback((action, opts) => {
    runAction(selectedItems, action, opts)
  }, [runAction, selectedItems])

  /** The open message as a row (list row if present, else built from the reader data). */
  const openRow = useCallback(() => {
    const rd = readerRef.current
    if (!rd.data) return null
    const row = listRef.current.items.find(i => i.id === rd.data.id)
    if (row) return row
    return { ...rd.data, threadCount: rd.data.thread?.length || 1 }
  }, [])

  const onReaderAction = useCallback((action, opts) => {
    const row = openRow()
    if (!row) return
    // The reader already knows the conversation; avoid a refetch when expanding.
    if (readerRef.current.data?.thread) threadCache.current.set(row.id, readerRef.current.data.thread)
    runAction([{ ...row, threadCount: Math.max(row.threadCount || 1, readerRef.current.data?.thread?.length || 1) }], action, opts)
  }, [openRow, runAction])

  const onReaderMessageAction = useCallback((id, action) => {
    const row = listRef.current.items.find(i => i.id === id) || { id }
    if (action === 'star' || action === 'unstar') patchItems([id], { flagged: action === 'star' })
    if (readerRef.current.data?.id === id) setReader(r => ({ ...r, data: { ...r.data, flagged: action === 'star' } }))
    mailApi.act([row.id], action).catch(err => toast.error(err.message))
  }, [patchItems])

  const onDragStart = useCallback((e, item) => {
    const sel = selectedRef.current
    const ids = sel.has(item.id) ? [...sel] : [item.id]
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.textContent = ids.length === 1 ? (item.subject || '(no subject)') : `${ids.length} messages`
    ghost.className = 'fixed -top-96 left-0 max-w-[260px] truncate rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-lg'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 14, 14)
    setTimeout(() => ghost.remove(), 0)
  }, [])

  const onDropMessages = useCallback((target, ids) => {
    if (!target) return
    let rows = listRef.current.items.filter(i => ids.includes(i.id))
    if (target.accountId) {
      const before = rows.length
      rows = rows.filter(r => r.accountId === target.accountId)
      if (!rows.length && before) { toast.error("Messages can't move between mailboxes"); return }
    }
    if (target.folderId) rows = rows.filter(r => r.folderId !== target.folderId)
    if (target.role) rows = rows.filter(r => r.folderRole !== target.role)
    runAction(rows, target.action, { folderId: target.folderId, label: target.label })
    clearSelection()
  }, [runAction, clearSelection])

  // ─── Folders CRUD ───────────────────────────────────────────────────────────
  const createFolder = useCallback(async (body) => {
    try {
      await mailApi.createFolder(body)
      await loadFolders()
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }, [loadFolders])

  const renameFolder = useCallback(async (folder, name) => {
    try {
      const updated = await mailApi.renameFolder(folder.id, name)
      if (updated) setFolders(prev => prev.map(f => (f.id === folder.id ? { ...f, ...updated } : f)))
      loadFolders()
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }, [loadFolders])

  const deleteFolder = useCallback(async (folder) => {
    try {
      await mailApi.deleteFolder(folder.id)
      if (loc.type === 'folder' && loc.folderId === folder.id) navigate({ role: 'INBOX' })
      setFolders(prev => prev.filter(f => f.id !== folder.id))
      loadFolders()
      toast.success('Folder deleted')
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }, [loc, navigate, loadFolders])

  // ─── Scheduled ──────────────────────────────────────────────────────────────
  const [scheduledCount, setScheduledCount] = useState(0)
  const [scheduledKey, setScheduledKey] = useState(0)
  const refreshScheduled = useCallback(async () => {
    try { setScheduledCount((await mailApi.outbox(accountId)).length) } catch {}
  }, [accountId])
  useEffect(() => { refreshScheduled() }, [refreshScheduled])

  const reopenFromPayload = useCallback((payload, item) => {
    if (!payload) return
    // Same path as the composer's own undo-send: the stored compose payload, restored as-is
    // (keeps mode, draftId, inReplyToId, attachments; no second signature).
    composerRef.current?.open({
      ...payload,
      accountId: payload.accountId || item?.accountId,
      restore: true,
      dirty: true,
    })
  }, [])

  // ─── Sync ───────────────────────────────────────────────────────────────────
  const [syncMap, setSyncMap] = useState(() => Object.fromEntries(accounts.map(a => [a.id, a.sync || {}])))
  const [syncingNow, setSyncingNow] = useState(false)
  const pollNowRef = useRef(() => {})

  const syncSummary = useMemo(() => {
    if (syncingNow) return { state: 'syncing' }
    const rows = scopeIds.map(id => ({ id, ...(syncMap[id] || {}) }))
    const failing = rows.filter(s => s.status === 'ERROR')
    if (failing.length) {
      const error = failing.map(s => (scopeIds.length > 1 ? `${accountsById[s.id]?.name}: ${s.lastError || 'Sync failed'}` : s.lastError || 'Sync failed')).join(' · ')
      return { state: 'error', error }
    }
    if (rows.some(s => s.idle)) return { state: 'live' }
    if (rows.some(s => s.status === 'SYNCING')) return { state: 'syncing' }
    const last = rows.map(s => s.lastSyncAt).filter(Boolean).sort().pop()
    return { state: 'ok', lastSyncAt: last }
  }, [syncingNow, scopeIds, syncMap, accountsById])

  const syncNow = useCallback(async () => {
    setSyncingNow(true)
    const results = await Promise.allSettled(scopeIds.map(id => mailApi.syncAccount(id)))
    setSyncingNow(false)
    const failed = results.find(r => r.status === 'rejected')
    if (failed) toast.error(failed.reason?.message || 'Sync failed')
    loadFolders()
    fetchList({ silent: true })
    pollNowRef.current()
  }, [scopeIds, loadFolders, fetchList])

  // ─── Live updates ───────────────────────────────────────────────────────────
  const notifiedRef = useRef(new Set())
  const scheduledCountRef = useRef(scheduledCount)
  scheduledCountRef.current = scheduledCount
  const viewRef = useRef(view)
  viewRef.current = view

  const openFromNotification = useCallback((m) => {
    window.focus()
    const patch = { folder: null, role: null, view: null, q: null, m: m.id }
    if (accountId !== 'all' && m.accountId !== accountId) patch.account = null
    setUrl(patch, { push: true })
  }, [accountId, setUrl])

  const handleUpdates = (data) => {
    if (data.sync) setSyncMap(prev => ({ ...prev, ...data.sync }))
    if (data.unread) {
      // Every folder with unseen mail is listed per account; missing ones are at zero.
      setFolders(prev => prev.map(f => {
        const acc = data.unread[f.accountId]
        if (!acc) return f
        const n = Number(acc.folders?.[f.id]) || 0
        return n === (f.unread || 0) ? f : { ...f, unread: n }
      }))
    }

    const latest = Array.isArray(data.latest) ? data.latest : []
    const fresh = latest.filter(m => !notifiedRef.current.has(m.id))
    fresh.forEach(m => notifiedRef.current.add(m.id))

    if (fresh.length && typeof window !== 'undefined' && 'Notification' in window &&
      Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
      for (const m of fresh.slice(0, 3)) {
        try {
          const n = new Notification(displayName(m.from) || 'New message', { body: m.subject || '(no subject)', tag: `mail-${m.id}`, icon: '/en-icon.png' })
          n.onclick = () => { openFromNotification(m); n.close() }
        } catch {}
      }
    }

    // Merge new inbox mail into the list when it belongs here.
    const p = paramsRef.current
    const newCount = Number(data.newCount) || 0
    if (p && !p.q && (newCount || latest.length)) {
      const folderRoleOf = (id) => folders.find(f => f.id === id)?.role
      const inboxList = p.role === 'INBOX' || (p.folderId && folderRoleOf(p.folderId) === 'INBOX') || p.view === 'unread'
      const inScope = (m) => p.accountId === 'all' || m.accountId === p.accountId
      const belongs = (m) => inScope(m) && (
        p.role === 'INBOX' || (p.folderId && m.folderId === p.folderId) || p.view === 'unread' ||
        (p.view === 'attachments' && m.hasAttachments))
      if (inboxList && newCount > latest.length) {
        fetchList({ silent: true })
      } else {
        const mine = latest.filter(belongs).sort((a, b) => time(a) - time(b))
        if (mine.length) {
          threadCache.current.clear()
          setList(prev => {
            let items = prev.items
            let added = 0
            for (const m of mine) {
              if (items.some(i => i.id === m.id)) continue
              if (p.threads && m.threadKey) {
                const ix = items.findIndex(i => i.threadKey === m.threadKey && i.accountId === m.accountId)
                if (ix >= 0) {
                  const old = items[ix]
                  items = [{ ...m, threadCount: (old.threadCount || 1) + 1, threadUnread: (old.threadUnread || 0) + 1 }, ...items.filter((_, k) => k !== ix)]
                  continue
                }
                items = [{ ...m, threadCount: 1, threadUnread: 1 }, ...items]
              } else {
                items = [m, ...items]
              }
              added++
            }
            if (items === prev.items) return prev
            return { ...prev, items: [...items].sort(byDateDesc), total: prev.total + added }
          })
        }
      }
    }

    // Changes made elsewhere (webmail, phone, a colleague) to flags or other folders
    // don't show up as "new inbox mail" — re-check the open list every 30s.
    if (p && !p.q && !listRef.current.loading && Date.now() - lastSilentRef.current > 30_000) {
      lastSilentRef.current = Date.now()
      fetchList({ silent: true })
    }

    if (scheduledCountRef.current > 0) refreshScheduled()
    if (viewRef.current === 'scheduled') setScheduledKey(k => k + 1)
  }
  const lastSilentRef = useRef(Date.now())
  const handleUpdatesRef = useRef(handleUpdates)
  handleUpdatesRef.current = handleUpdates

  useEffect(() => {
    let timer = null
    let stopped = false
    let inFlight = false
    let ctrl = null
    let since = new Date().toISOString()

    const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(tick, ms) }
    async function tick() {
      if (stopped || inFlight) return
      inFlight = true
      ctrl = new AbortController()
      try {
        const data = await mailApi.updates(since, ctrl.signal)
        if (stopped) return
        if (data?.now) since = data.now
        handleUpdatesRef.current(data || {})
      } catch {}
      finally { inFlight = false }
      if (!stopped) schedule(document.hidden ? POLL_HIDDEN : POLL_VISIBLE)
    }
    const onVisibility = () => { if (!document.hidden && !inFlight) { clearTimeout(timer); tick() } }

    pollNowRef.current = () => { if (!inFlight) { clearTimeout(timer); tick() } }
    schedule(1500)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      ctrl?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
      pollNowRef.current = () => {}
    }
  }, [])

  // Tab title unread count.
  useEffect(() => {
    const original = document.title
    return () => { document.title = original }
  }, [])
  useEffect(() => {
    document.title = scopeInboxUnread ? `(${scopeInboxUnread > 999 ? '999+' : scopeInboxUnread}) Mail` : 'Mail'
  }, [scopeInboxUnread])

  // Composer callbacks (wired through the page's ComposerProvider).
  const locRoleRef = useRef(locRole)
  locRoleRef.current = locRole
  useEffect(() => {
    if (!bridge) return
    bridge.current = {
      onSent: () => {
        refreshScheduled()
        scheduleFolders(1500)
        // The sent copy lands after the undo delay + an IMAP append. Check the folder
        // when each timer fires — the user often switches to Sent right after sending.
        const refreshIfOutgoing = () => {
          if (['SENT', 'DRAFTS'].includes(locRoleRef.current)) fetchList({ silent: true })
        }
        for (const ms of [1500, 6000, 12_000, 20_000]) setTimeout(refreshIfOutgoing, ms)
        if (viewRef.current === 'scheduled') setScheduledKey(k => k + 1)
      },
      onDraftSaved: () => {
        scheduleFolders(1500)
        if (locRoleRef.current === 'DRAFTS') fetchList({ silent: true })
      },
    }
  }, [bridge, refreshScheduled, scheduleFolders, fetchList])

  // ─── Keyboard ───────────────────────────────────────────────────────────────
  const handleKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if (isTypingTarget(e.target)) return
    // Focus inside a composer window / dialog belongs to it.
    if (e.target?.closest?.('[role="dialog"]')) return
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('button, a, [role="option"], [role="button"], [role="menuitem"]')) return
    const modalOpen = document.body.style.pointerEvents === 'none' || !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
    if (e.key === '?') {
      if (!modalOpen || shortcutsOpen) { e.preventDefault(); setShortcutsOpen(o => !o) }
      return
    }
    if (modalOpen) return

    const items = listRef.current.items
    const rd = readerRef.current
    const cursorRow = items.find(i => i.id === cursorId)
    const targets = () => {
      if (selected.size) return items.filter(i => selected.has(i.id))
      if (openId) { const r = openRow(); return r ? [r] : [] }
      return cursorRow ? [cursorRow] : []
    }
    const doAction = (action) => {
      const t = targets()
      if (!t.length) return
      e.preventDefault()
      if (!selected.size && openId) onReaderAction(action)
      else runAction(t, action)
    }
    const reply = async (mode) => {
      e.preventDefault()
      let full = rd.data && rd.id === openId ? rd.data : null
      if (!full && cursorRow && !isDraftItem(cursorRow)) {
        try { full = await mailApi.message(cursorRow.id, { peek: true }) } catch (err) { toast.error(err.message) }
      }
      if (full && !isDraftItem(full)) replyWith(mode, full)
    }

    switch (e.key) {
      case 'j':
      case 'k': {
        if (view === 'scheduled' || !items.length) return
        e.preventDefault()
        const cur = openId || cursorId
        const idx = items.findIndex(i => i.id === cur)
        const nextIdx = idx < 0 ? 0 : Math.min(items.length - 1, Math.max(0, idx + (e.key === 'j' ? 1 : -1)))
        const target = items[nextIdx]
        if (!target) return
        setCursorId(target.id)
        if (openId && !isDraftItem(target) && target.id !== openId) setUrl({ m: target.id })
        if (e.key === 'j' && nextIdx >= items.length - 3) loadMore()
        return
      }
      case 'Enter':
      case 'o': {
        const row = cursorRow || (!openId && items[0])
        if (row && row.id !== openId) { e.preventDefault(); openItem(row) }
        return
      }
      case 'u':
        if (openId) { e.preventDefault(); closeReader() }
        return
      case 'Escape':
        if (selected.size) { e.preventDefault(); clearSelection() }
        else if (openId && !isLg) { e.preventDefault(); closeReader() }
        return
      case 'e': {
        const t = targets()
        if (t.length && t.every(r => ['ARCHIVE', 'TRASH', 'SPAM', 'DRAFTS'].includes(r.folderRole))) return
        doAction('archive')
        return
      }
      case '#':
      case 'Delete':
        doAction('trash')
        return
      case '!': {
        const t = targets()
        doAction(t.length && t.every(r => r.folderRole === 'SPAM') ? 'notSpam' : 'spam')
        return
      }
      case 's': {
        const t = targets()
        if (!t.length) return
        doAction(t.some(r => !r.flagged) ? 'star' : 'unstar')
        return
      }
      case 'I':
        doAction('read')
        return
      case 'U':
        doAction('unread')
        return
      case 'r':
        reply('reply')
        return
      case 'a':
        reply('replyAll')
        return
      case 'f':
        reply('forward')
        return
      case 'c':
        e.preventDefault()
        compose()
        return
      case '/':
        e.preventDefault()
        searchRef.current?.focus()
        return
      case 'x':
        if (cursorRow) { e.preventDefault(); toggleSelect(cursorRow, false) }
        return
      default:
    }
  }
  const handleKeyRef = useRef(handleKey)
  handleKeyRef.current = handleKey
  useEffect(() => {
    const onKey = (e) => handleKeyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ─── Render ─────────────────────────────────────────────────────────────────
  const items = list.items
  const openIdx = openId ? items.findIndex(i => i.id === openId) : -1
  const readerFolders = useMemo(
    () => (reader.data ? folders.filter(f => f.accountId === reader.data.accountId) : null),
    [folders, reader.data]
  )
  const selAccounts = new Set(selectedItems.map(i => i.accountId))
  const bulkFolders = selAccounts.size === 1 ? folders.filter(f => f.accountId === [...selAccounts][0]) : null

  const onRailButton = isXl
    ? () => setRailHidden(h => { writePref(RAIL_KEY, !h); return !h })
    : () => setRailSheet(true)
  const railButtonLabel = isXl ? (railHidden ? 'Show folders' : 'Hide folders') : 'Folders'

  const rail = (
    <FolderRail
      accounts={accounts}
      accountId={accountId}
      onAccountChange={changeAccount}
      unreadByAccount={unreadByAccount}
      canManage={canManage}
      folders={folders}
      activeKey={activeKey}
      onNavigate={navigate}
      scheduledCount={scheduledCount}
      onCompose={() => { setRailSheet(false); compose() }}
      onCreateFolder={createFolder}
      onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder}
      onDropMessages={onDropMessages}
      sync={syncSummary}
      syncing={syncingNow}
      onSyncNow={syncNow}
      notifyPermission={notifyPermission}
      onEnableNotifications={requestNotify}
      onShowShortcuts={() => setShortcutsOpen(true)}
      className={railDocked ? undefined : 'w-full border-r-0 bg-white'}
    />
  )

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="relative flex h-full min-h-0 flex-1 overflow-hidden">
        {railDocked && rail}
        {!railDocked && railSheet && (
          <>
            <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] animate-in fade-in-0 duration-200" onClick={() => setRailSheet(false)} />
            <div className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl animate-in slide-in-from-left duration-200">
              {rail}
            </div>
          </>
        )}

        {view === 'scheduled' ? (
          <ScheduledList
            accountId={accountId}
            accountsById={accountsById}
            showAccount={accountId === 'all' && accounts.length > 1}
            refreshKey={scheduledKey}
            onCancelled={reopenFromPayload}
            onChanged={refreshScheduled}
            onRailButton={onRailButton}
            railButtonLabel={railButtonLabel}
          />
        ) : (
          <>
            <MessageList
              className={cn('w-full lg:w-[360px] lg:shrink-0 lg:border-r lg:border-gray-200/80 xl:w-[380px] 2xl:w-[420px]', openId && 'hidden lg:flex')}
              title={title}
              items={items}
              loading={list.loading}
              loadingMore={loadingMore}
              error={list.error}
              total={list.total}
              hasMore={!!list.nextCursor}
              hasMoreRemote={list.hasMoreRemote && !!singleFolder}
              loadingOlder={loadingOlder}
              onLoadMore={loadMore}
              onLoadOlder={loadOlder}
              onRetry={() => fetchList()}
              onRefresh={refresh}
              refreshing={refreshing}
              activeId={openId}
              cursorId={cursorId}
              selected={selected}
              onToggle={toggleSelect}
              onToggleAll={selectAll}
              onClearSelection={clearSelection}
              onOpen={openItem}
              onQuick={onQuick}
              onStar={onStar}
              onDragStart={onDragStart}
              accountsById={accountsById}
              showAccountStripe={accountId === 'all' && accounts.length > 1}
              outgoing={locRole === 'SENT' || locRole === 'DRAFTS'}
              search={q}
              onSearch={setSearch}
              searchRef={searchRef}
              chips={chips}
              onChip={toggleChip}
              hiddenChips={view === 'starred' ? ['starred'] : view === 'unread' ? ['unread'] : view === 'attachments' ? ['attachments'] : []}
              threads={threads}
              onThreads={(on) => { setThreadsPref(on); writePref(THREADS_KEY, on) }}
              threadsDisabled={threadsDisabled}
              emptyIcon={loc.type === 'view' ? VIEW_META[loc.view]?.icon : ROLE_META[locRole || 'INBOX']?.icon}
              onRailButton={onRailButton}
              railButtonLabel={railButtonLabel}
              bulk={{
                role: locRole,
                anyUnread: selectedItems.some(i => (i.threadUnread != null ? i.threadUnread > 0 : !i.seen)),
                anyUnstarred: selectedItems.some(i => !i.flagged),
                moveFolders: bulkFolders,
                excludeFolderIds: loc.type === 'folder' ? [loc.folderId] : [],
                onAction: onBulkAction,
              }}
            />
            <Reader
              className={cn(openId ? 'flex' : 'hidden lg:flex')}
              message={reader.data}
              loading={reader.loading}
              error={reader.error}
              onRetry={() => openId && loadReader(openId)}
              accountsById={accountsById}
              folders={readerFolders}
              showAccount={accounts.length > 1}
              onBack={closeReader}
              hasPrev={openIdx > 0}
              hasNext={openIdx >= 0 && openIdx < items.length - 1}
              onPrev={() => { const t = items[openIdx - 1]; if (t) openItem(t) }}
              onNext={() => { const t = items[openIdx + 1]; if (t) openItem(t) }}
              onAction={onReaderAction}
              onMessageAction={onReaderMessageAction}
              onReply={replyWith}
              onEditDraft={editDraft}
              onMailto={onMailto}
            />
          </>
        )}

        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

        <Modal open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)} title="Delete forever?" size="sm">
          <p className="text-sm text-gray-600">
            {confirmDelete?.rows.length === 1
              ? 'This message will be permanently deleted.'
              : `${plural(confirmDelete?.rows.length || 0, threads ? 'conversation' : 'message')} will be permanently deleted.`}
          </p>
          <ModalFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const rows = confirmDelete?.rows || []
                setConfirmDelete(null)
                clearSelection()
                executeAction(rows, 'delete')
              }}
            >
              Delete forever
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </Tooltip.Provider>
  )
}
