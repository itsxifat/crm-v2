'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import toast from 'react-hot-toast'
import {
  AlertCircle, Check, ChevronDown, Maximize2, Minimize2, Minus, MoreHorizontal, Paperclip, Trash2, Type, X,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import { MAIL_LIMITS } from '@/lib/mail/constants'
import { cn } from '@/lib/utils'
import RecipientInput from './RecipientInput'
import RichTextEditor from './RichTextEditor'
import EditorToolbar, { LinkPopover } from './EditorToolbar'
import AttachmentChips from './AttachmentChips'
import ScheduleMenu from './ScheduleMenu'
import { useDraftAutosave } from './useDraftAutosave'
import { IconButton, MOD, Tip, menuContent, menuItem } from './parts'
import {
  formatBytes, isBlankHtml, isValidAddress, mailApi, removeMirror, signatureHtml,
  toPayloadAttachments, touchMirror, uid, uploadMailFile, writeMirror,
} from './composeUtils'

const TOOLBAR_PREF_KEY = 'mail:composerToolbar'

function readToolbarPref() {
  try { return localStorage.getItem(TOOLBAR_PREF_KEY) !== '0' } catch { return true }
}

const accountName = (a) => a?.fromName || a?.name || a?.email || ''

function FromSelect({ accounts, value, onChange }) {
  const current = accounts.find((a) => String(a.id) === String(value))
  return (
    <div className="flex h-10 items-center gap-2 border-b border-gray-100 px-4">
      <span className="w-12 shrink-0 text-[13px] text-gray-500">From</span>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger className="-ml-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm text-gray-900 outline-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-gray-50">
          {current?.color && <span className="size-2 shrink-0 rounded-full" style={{ background: current.color }} />}
          <span className="truncate">
            {current ? <>{accountName(current)} <span className="text-gray-500">&lt;{current.email}&gt;</span></> : 'Choose account'}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-gray-400" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} collisionPadding={8} className={cn(menuContent, 'max-h-72 w-72 overflow-y-auto')}>
            {accounts.map((a) => (
              <DropdownMenu.Item key={a.id} onSelect={() => onChange(String(a.id))} className={menuItem}>
                <span className="size-2 shrink-0 rounded-full bg-gray-300" style={a.color ? { background: a.color } : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-gray-900">{accountName(a)}</span>
                  <span className="block truncate text-xs text-gray-500">{a.email}</span>
                </span>
                {String(a.id) === String(value) && <Check className="size-4 shrink-0 text-gray-900" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

/**
 * One floating compose window. State is local; the provider only tracks
 * placement (minimized/maximized) and receives `onRemove` / `onSent`.
 */
export default function ComposerWindow({
  win, accounts, setMinimized, toggleMaximize, onRemove, register, onSent, onDraftSaved,
}) {
  const { key, init } = win
  const [accountId, setAccountId] = useState(init.accountId)
  const [to, setTo] = useState(init.to)
  const [cc, setCc] = useState(init.cc)
  const [bcc, setBcc] = useState(init.bcc)
  const [showCc, setShowCc] = useState(init.cc.length > 0)
  const [showBcc, setShowBcc] = useState(init.bcc.length > 0)
  const [focusField, setFocusField] = useState(null)
  const [subject, setSubject] = useState(init.subject)
  const [attachments, setAttachments] = useState(init.attachments)
  const [quoteHtml, setQuoteHtml] = useState(init.quoteHtml)
  const [formats, setFormats] = useState({})
  const [link, setLink] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [showToolbar, setShowToolbar] = useState(readToolbarPref)
  const [initialFocus] = useState(() => (win.minimized ? null : init.to.length ? 'editor' : 'to'))

  const rootRef = useRef(null)
  const editorRef = useRef(null)
  const toRef = useRef(null)
  const ccRef = useRef(null)
  const bccRef = useRef(null)
  const fileRef = useRef(null)
  const uploadsRef = useRef(new Map())
  const conversionRef = useRef(null)
  const mirrorTimer = useRef(null)
  const dragDepth = useRef(0)
  const closedRef = useRef(false)
  const sendingRef = useRef(false)
  const pendingChangeRef = useRef(false)
  const frozenHtml = useRef(null)
  // Mutated synchronously so payloads built right after an upload see it.
  const attRef = useRef(init.attachments)
  const stateRef = useRef(null)
  stateRef.current = {
    accountId, to, cc, bcc, subject, quoteHtml,
    attachments: attRef.current, mode: init.mode, inReplyToId: init.inReplyToId,
  }

  const editorHtml = useCallback(() => {
    if (frozenHtml.current != null) return frozenHtml.current
    return editorRef.current ? editorRef.current.getHtml() : init.html
  }, [init.html])

  const basePayload = useCallback(() => {
    const s = stateRef.current
    const body = editorHtml()
    const payload = {
      accountId: s.accountId,
      to: s.to, cc: s.cc, bcc: s.bcc,
      subject: s.subject,
      html: body + (s.quoteHtml || ''),
      attachments: toPayloadAttachments(s.attachments),
      mode: s.mode,
    }
    if (s.inReplyToId) payload.inReplyToId = s.inReplyToId
    return { payload, body }
  }, [editorHtml])

  const getDraftPayload = useCallback(({ draftId }) => {
    const { payload, body } = basePayload()
    const valid = (list) => list.filter((a) => isValidAddress(a.address))
    payload.to = valid(payload.to)
    payload.cc = valid(payload.cc)
    payload.bcc = valid(payload.bcc)
    const empty = !draftId && !payload.to.length && !payload.cc.length && !payload.bcc.length
      && !payload.subject.trim() && !payload.attachments.length && isBlankHtml(body)
    return empty || !payload.accountId ? null : payload
  }, [basePayload])

  const autosave = useDraftAutosave({
    initialDraftId: init.draftId,
    initialDirty: init.dirty,
    getPayload: getDraftPayload,
    beforeSave: () => convertDraftAttachments(),
    onSaved: (info) => {
      if (!info.dirty) removeMirror(key)
      onDraftSaved?.(info)
    },
  })

  function snapshot() {
    const s = stateRef.current
    return {
      mode: s.mode,
      accountId: s.accountId,
      to: s.to, cc: s.cc, bcc: s.bcc,
      subject: s.subject,
      html: editorHtml(),
      quoteHtml: s.quoteHtml,
      attachments: toPayloadAttachments(s.attachments),
      draftId: autosave.getDraftId(),
      inReplyToId: s.inReplyToId,
    }
  }

  function writeMirrorNow() {
    if (closedRef.current) return
    writeMirror(key, { ...snapshot(), dirty: true })
  }

  function scheduleMirror() {
    clearTimeout(mirrorTimer.current)
    mirrorTimer.current = setTimeout(writeMirrorNow, 800)
  }

  function changed() {
    if (closedRef.current) return
    // No autosave while a send is in flight (it would replace the draft the send deletes).
    if (sendingRef.current) { pendingChangeRef.current = true; return }
    if (error) setError('')
    autosave.markDirty()
    scheduleMirror()
    convertDraftAttachments()
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  function updateAttachments(fn) {
    const next = fn(attRef.current)
    attRef.current = next
    setAttachments(next)
  }

  /** Upload a file into a (new or existing) chip; resolves true on success. */
  function startUpload(file, replaceKey) {
    const chipKey = replaceKey || uid()
    const chip = {
      key: chipKey, type: 'upload', file,
      filename: file.name || 'Attachment', size: file.size,
      contentType: file.type || 'application/octet-stream',
      status: 'uploading', progress: 0,
    }
    updateAttachments((list) => (list.some((a) => a.key === chipKey)
      ? list.map((a) => (a.key === chipKey ? chip : a))
      : [...list, chip]))
    let lastPct = -1
    const { promise, abort } = uploadMailFile(file, {
      onProgress: (p) => {
        const pct = Math.floor(p * 100)
        if (pct === lastPct) return
        lastPct = pct
        updateAttachments((list) => list.map((a) => (a.key === chipKey ? { ...a, progress: p } : a)))
      },
    })
    uploadsRef.current.set(chipKey, abort)
    return promise.then(
      (data) => {
        updateAttachments((list) => list.map((a) => (a.key === chipKey ? {
          key: chipKey, type: 'upload', id: String(data.id),
          filename: data.filename || a.filename, size: data.size ?? a.size,
          contentType: data.contentType || a.contentType, status: 'done', progress: 1,
        } : a)))
        changed()
        return true
      },
      (err) => {
        if (!err?.aborted) {
          updateAttachments((list) => list.map((a) => (a.key === chipKey ? { ...a, status: 'error', error: err?.message || 'Upload failed' } : a)))
        }
        return false
      }
    ).finally(() => uploadsRef.current.delete(chipKey))
  }

  /**
   * Attachments of a server draft are referenced as { type:'message', messageId: draftId }.
   * Saving a new draft version deletes that message, so before the first save
   * they are copied into composer uploads.
   */
  function convertDraftAttachments() {
    if (conversionRef.current) return conversionRef.current
    const draftId = autosave.getDraftId()
    const refs = draftId ? attRef.current.filter((a) => a.type === 'message' && a.messageId === draftId && a.status === 'done') : []
    if (!refs.length) return null
    const convertOne = async (a) => {
      updateAttachments((list) => list.map((x) => (x.key === a.key ? { ...x, status: 'uploading', progress: 0 } : x)))
      let file
      try {
        const res = await fetch(`/api/mail/messages/${a.messageId}/attachments/${a.idx}`)
        if (!res.ok) throw new Error('Download failed')
        const blob = await res.blob()
        file = new File([blob], a.filename || 'attachment', { type: a.contentType || blob.type || 'application/octet-stream' })
      } catch {
        updateAttachments((list) => list.map((x) => (x.key === a.key ? { ...x, status: 'error', error: 'Attach this file again' } : x)))
        return
      }
      await startUpload(file, a.key)
    }
    conversionRef.current = Promise.all(refs.map(convertOne)).finally(() => { conversionRef.current = null })
    return conversionRef.current
  }

  function addFiles(list) {
    const files = Array.from(list || []).filter(Boolean)
    if (!files.length || closedRef.current) return
    if (win.minimized) setMinimized(key, false)
    let total = attRef.current.reduce((n, a) => n + (a.status === 'error' ? 0 : Number(a.size) || 0), 0)
    for (const f of files) {
      if (f.size > MAIL_LIMITS.attachmentBytes) {
        toast.error(`${f.name} is larger than ${formatBytes(MAIL_LIMITS.attachmentBytes)}`)
        continue
      }
      if (total + f.size > MAIL_LIMITS.totalAttachmentBytes) {
        toast.error(`Attachments can't exceed ${formatBytes(MAIL_LIMITS.totalAttachmentBytes)}`)
        break
      }
      total += f.size
      startUpload(f)
    }
  }

  function removeAttachment(chipKey) {
    uploadsRef.current.get(chipKey)?.()
    updateAttachments((list) => list.filter((a) => a.key !== chipKey))
    changed()
  }

  function retryAttachment(chipKey) {
    const a = attRef.current.find((x) => x.key === chipKey)
    if (a?.file) startUpload(a.file, chipKey)
  }

  // ── From / recipients ────────────────────────────────────────────────────

  function changeAccount(id) {
    if (String(id) === String(accountId)) return
    const next = accounts.find((a) => String(a.id) === String(id))
    setAccountId(String(id))
    // Drafts come back server-sanitised (the marker may be gone) → don't add a second signature.
    editorRef.current?.swapSignature(signatureHtml(next), { insertIfMissing: init.mode !== 'draft' })
    changed()
  }

  // Opened before accounts loaded, or the account went away → fall back to the first one.
  useEffect(() => {
    if (!accounts.length || accounts.some((a) => String(a.id) === String(accountId))) return
    const fallback = accounts[0]
    setAccountId(String(fallback.id))
    editorRef.current?.swapSignature(signatureHtml(fallback), { insertIfMissing: init.mode !== 'draft' })
  }, [accounts, accountId, init.mode])

  function revealCc() { setShowCc(true); setFocusField('cc') }
  function revealBcc() { setShowBcc(true); setFocusField('bcc') }

  // ── Link popover ─────────────────────────────────────────────────────────

  function openLink() {
    const info = editorRef.current?.beginLink()
    if (info) setLink(info)
  }

  // ── Send / close / discard ───────────────────────────────────────────────

  function stopUploads() {
    for (const abort of uploadsRef.current.values()) abort()
  }

  async function send(sendAt) {
    if (sendingRef.current || closedRef.current) return
    const toList = toRef.current?.flush() ?? stateRef.current.to
    const ccList = ccRef.current?.flush() ?? stateRef.current.cc
    const bccList = bccRef.current?.flush() ?? stateRef.current.bcc
    const all = [...toList, ...ccList, ...bccList]
    const fail = (msg) => { setError(msg) }
    if (!accounts.some((a) => String(a.id) === String(stateRef.current.accountId))) return fail('Choose an account to send from')
    if (!all.length) return fail('Add at least one recipient')
    const bad = all.find((a) => !isValidAddress(a.address))
    if (bad) return fail(`Invalid address: ${bad.address}`)
    if (all.length > MAIL_LIMITS.maxRecipients) return fail(`Up to ${MAIL_LIMITS.maxRecipients} recipients per message`)
    if (attRef.current.some((a) => a.status === 'error')) return fail('Remove attachments that failed to upload')
    if (attRef.current.some((a) => a.status === 'uploading') && !conversionRef.current) return fail('Attachments are still uploading')

    setError('')
    setSending(true)
    sendingRef.current = true
    pendingChangeRef.current = false
    autosave.cancel()
    const startedAt = Date.now()
    try {
      if (conversionRef.current) await conversionRef.current
      if (attRef.current.some((a) => a.status === 'uploading')) throw new Error('Attachments are still uploading')
      if (attRef.current.some((a) => a.status === 'error')) throw new Error('Remove attachments that failed to upload')
      // An in-flight autosave may still replace the draft; send must reference the final id.
      await autosave.waitIdle()
      const { payload } = basePayload()
      payload.to = toList
      payload.cc = ccList
      payload.bcc = bccList
      const draftId = autosave.getDraftId()
      if (draftId) payload.draftId = draftId
      if (sendAt) payload.sendAt = sendAt.toISOString()
      else payload.undoSeconds = MAIL_LIMITS.undoSendSeconds
      const data = await mailApi('/api/mail/send', { method: 'POST', body: payload })
      const snap = { ...snapshot(), to: toList, cc: ccList, bcc: bccList }
      closedRef.current = true
      clearTimeout(mirrorTimer.current)
      removeMirror(key)
      onRemove(key)
      onSent({ data: { ...(data || {}), accountId: payload.accountId }, snapshot: snap, sendAt, startedAt })
    } catch (err) {
      setError(err?.message || 'Could not send the message')
      setSending(false)
      sendingRef.current = false
      if (pendingChangeRef.current) { pendingChangeRef.current = false; changed() }
      else if (autosave.isDirty()) autosave.schedule()
    }
  }

  function close() {
    // Closing mid-send would save a fresh draft the send can't delete.
    if (closedRef.current || sendingRef.current) return
    // Commit half-typed addresses; the component unmounts before state would settle.
    const toList = toRef.current?.flush() ?? stateRef.current.to
    const ccList = ccRef.current?.flush() ?? stateRef.current.cc
    const bccList = bccRef.current?.flush() ?? stateRef.current.bcc
    stateRef.current = { ...stateRef.current, to: toList, cc: ccList, bcc: bccList }
    closedRef.current = true
    frozenHtml.current = editorRef.current ? editorRef.current.getHtml() : null
    autosave.cancel()
    clearTimeout(mirrorTimer.current)
    stopUploads()
    const dirty = autosave.isDirty()
    if (dirty) writeMirror(key, { ...snapshot(), dirty: true })
    onRemove(key)
    if (!dirty) { removeMirror(key); return }
    autosave.flush()
      .then(() => removeMirror(key))
      .catch(() => toast.error("Couldn't save draft"))
  }

  async function discard() {
    if (closedRef.current || sendingRef.current) return
    closedRef.current = true
    autosave.cancel()
    clearTimeout(mirrorTimer.current)
    stopUploads()
    removeMirror(key)
    onRemove(key)
    await autosave.waitIdle()
    const draftId = autosave.getDraftId()
    if (!draftId) return
    try {
      await mailApi(`/api/mail/drafts/${draftId}`, { method: 'DELETE' })
      onDraftSaved?.({ draftId, accountId: stateRef.current.accountId, deleted: true })
      toast('Draft discarded')
    } catch (err) {
      toast.error(err?.message || "Couldn't discard draft")
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  const handle = useRef(null)
  handle.current = { close, getDraftId: autosave.getDraftId, focus: () => editorRef.current?.focus() }
  useEffect(() => register(key, {
    close: () => handle.current.close(),
    getDraftId: () => handle.current.getDraftId(),
    focus: () => handle.current.focus(),
  }), [key, register])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (initialFocus === 'to') toRef.current?.focus()
      else if (initialFocus === 'editor') editorRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [initialFocus])

  // Heartbeat keeps another tab from "recovering" this live composer.
  useEffect(() => {
    const id = setInterval(() => touchMirror(key), 10000)
    return () => { clearInterval(id); clearTimeout(mirrorTimer.current) }
  }, [key])

  const restoredRef = useRef(init.dirty)
  useEffect(() => {
    if (restoredRef.current) { restoredRef.current = false; writeMirror(key, { ...init, attachments: toPayloadAttachments(init.attachments), dirty: true }) }
  }, [key, init])

  const onFormats = useCallback((next) => {
    setFormats((prev) => (Object.keys(next).every((k) => prev[k] === next[k]) ? prev : next))
  }, [])

  function toggleToolbar() {
    setShowToolbar((v) => {
      try { localStorage.setItem(TOOLBAR_PREF_KEY, v ? '0' : '1') } catch { /* ignore */ }
      return !v
    })
  }

  function onKeyDown(e) {
    // Ignore keys bubbling (through React portals) from menus and dialogs.
    if (!rootRef.current?.contains(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key === 'Enter') { e.preventDefault(); send(); return }
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setMinimized(key, true); return }
    if (mod && e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'c') { e.preventDefault(); revealCc() }
      else if (k === 'b') { e.preventDefault(); revealBcc() }
    }
  }

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')

  const title = subject.trim() || 'New message'
  const statusText = { saving: 'Saving…', saved: 'Saved', error: 'Not saved' }[autosave.status] || ''

  const ccToggles = (!showCc || !showBcc) && (
    <>
      {!showCc && (
        <Tip label="Add Cc recipients" kbd={`${MOD}Shift+C`}>
          <button type="button" onClick={revealCc} className="rounded-md px-1.5 py-0.5 text-[13px] text-gray-500 hover:bg-gray-100 hover:text-gray-900">Cc</button>
        </Tip>
      )}
      {!showBcc && (
        <Tip label="Add Bcc recipients" kbd={`${MOD}Shift+B`}>
          <button type="button" onClick={revealBcc} className="rounded-md px-1.5 py-0.5 text-[13px] text-gray-500 hover:bg-gray-100 hover:text-gray-900">Bcc</button>
        </Tip>
      )}
    </>
  )

  return (
    <section
      ref={rootRef}
      role="dialog"
      aria-label={title}
      onKeyDown={onKeyDown}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
      className={cn(
        'pointer-events-auto relative flex flex-col overflow-hidden bg-white',
        win.minimized
          ? 'w-[220px] rounded-t-xl border border-b-0 border-gray-200 shadow-lg sm:w-[280px]'
          : cn(
            'fixed inset-0 z-[46]',
            'sm:relative sm:inset-auto sm:z-auto sm:h-[min(620px,calc(100dvh-5rem))] sm:w-[560px] sm:rounded-t-xl sm:border sm:border-b-0 sm:border-gray-200 sm:shadow-2xl',
            win.maximized && 'sm:fixed sm:inset-0 sm:z-[47] sm:m-auto sm:h-[min(880px,calc(100dvh-4rem))] sm:w-[min(1080px,calc(100vw-4rem))] sm:rounded-xl sm:border-b'
          )
      )}
    >
      <header
        onClick={() => setMinimized(key, !win.minimized)}
        className={cn(
          'flex h-10 shrink-0 cursor-pointer select-none items-center gap-2 bg-gray-50/80 pl-4 pr-1.5',
          !win.minimized && 'border-b border-gray-100'
        )}
      >
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{title}</h2>
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <IconButton
            icon={Minus}
            label={win.minimized ? 'Expand' : 'Minimize'}
            className="size-7"
            onClick={() => setMinimized(key, !win.minimized)}
          />
          <IconButton
            icon={win.maximized ? Minimize2 : Maximize2}
            label={win.maximized ? 'Exit full screen' : 'Full screen'}
            className="hidden size-7 sm:inline-flex"
            iconClassName="size-3.5"
            onClick={() => toggleMaximize(key)}
          />
          <IconButton icon={X} label="Save & close" className="size-7" onClick={close} />
        </div>
      </header>

      <div className={cn('flex min-h-0 flex-1 flex-col', win.minimized && 'hidden')}>
        <div className="shrink-0">
          {accounts.length > 1 && <FromSelect accounts={accounts} value={accountId} onChange={changeAccount} />}
          <RecipientInput
            ref={toRef}
            label="To"
            value={to}
            onChange={(v) => { setTo(v); changed() }}
            trailing={ccToggles}
          />
          {showCc && (
            <RecipientInput ref={ccRef} label="Cc" value={cc} autoFocus={focusField === 'cc'} onChange={(v) => { setCc(v); changed() }} />
          )}
          {showBcc && (
            <RecipientInput ref={bccRef} label="Bcc" value={bcc} autoFocus={focusField === 'bcc'} onChange={(v) => { setBcc(v); changed() }} />
          )}
          <div className="border-b border-gray-100 px-4">
            <input
              type="text"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); changed() }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); editorRef.current?.focus() }
              }}
              placeholder="Subject"
              aria-label="Subject"
              className="h-10 w-full border-0 bg-transparent p-0 text-sm text-gray-900 shadow-none outline-none placeholder:text-gray-400 focus:border-0 focus:outline-none focus:ring-0"
            />
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-auto"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) { e.preventDefault(); editorRef.current?.focus({ atEnd: true }) }
          }}
        >
          <RichTextEditor
            ref={editorRef}
            initialHtml={init.html}
            onChange={changed}
            onFiles={addFiles}
            onRequestLink={openLink}
            onFormats={onFormats}
          />
          {quoteHtml && (
            <div className="px-4 pb-3">
              <Tip label="Show trimmed content">
                <button
                  type="button"
                  aria-label="Show trimmed content"
                  onClick={() => { editorRef.current?.appendHtml(quoteHtml); setQuoteHtml('') }}
                  className="inline-flex h-5 items-center rounded-full border border-gray-200 bg-gray-50 px-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </Tip>
            </div>
          )}
          <AttachmentChips items={attachments} onRemove={removeAttachment} onRetry={retryAttachment} className="px-4 pb-3" />
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 px-4 pb-2 text-[13px] text-red-600">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        <div className="relative shrink-0 px-3">
          {link && (
            <LinkPopover
              initial={link}
              onApply={(v) => { editorRef.current?.applyLink(v); setLink(null) }}
              onRemove={() => { editorRef.current?.removeLink(); setLink(null) }}
              onClose={({ restore } = {}) => { setLink(null); if (restore) editorRef.current?.cancelLink() }}
            />
          )}
          {showToolbar && (
            <EditorToolbar formats={formats} onCommand={(id) => editorRef.current?.command(id)} onLink={openLink} />
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-1 px-3 py-2.5">
          <div className="mr-1 flex items-center">
            <Tip label="Send" kbd={`${MOD}Enter`}>
              <Button onClick={() => send()} loading={sending} className="rounded-r-none pl-4 pr-3.5">Send</Button>
            </Tip>
            <ScheduleMenu disabled={sending} onSchedule={(d) => send(d)} />
          </div>
          <IconButton icon={Paperclip} label="Attach files" onClick={() => fileRef.current?.click()} />
          <IconButton icon={Type} label="Formatting options" pressed={showToolbar} onClick={toggleToolbar} />
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />
          <span className="ml-auto truncate pr-1 text-xs text-gray-400" aria-live="polite">{statusText}</span>
          <IconButton icon={Trash2} label="Discard draft" onClick={discard} />
        </footer>
      </div>

      {dragging && !win.minimized && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-gray-300 bg-white/90 text-sm font-medium text-gray-600">
          <Paperclip className="size-5 text-gray-400" />
          Drop files to attach
        </div>
      )}
    </section>
  )
}
