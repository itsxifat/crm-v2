'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Tooltip from '@radix-ui/react-tooltip'
import toast from 'react-hot-toast'
import { MAIL_LIMITS } from '@/lib/mail/constants'
import ComposerWindow from './ComposerWindow'
import UndoToast from './UndoToast'
import { buildInitialState, formatScheduled, mailApi, readRecoverableMirrors, uid } from './composeUtils'

const MAX_WINDOWS = 3
const DOCK_W = 560
const PILL_W = 280
const GAP = 12

const ComposerContext = createContext(null)

const FALLBACK = {
  open: () => {
    if (process.env.NODE_ENV !== 'production') console.warn('useComposer() is used outside <ComposerProvider>')
    return null
  },
  closeAll: () => {},
}

/** Minimise the oldest docked windows until the dock fits the viewport. */
function fitToViewport(windows, keepKey) {
  if (typeof window === 'undefined' || window.innerWidth < 640) return windows
  const available = window.innerWidth - 32
  const needed = (list) => list.reduce((n, w) => n + (w.maximized && !w.minimized ? 0 : (w.minimized ? PILL_W : DOCK_W) + GAP), 0)
  let next = windows
  while (needed(next) > available) {
    const victim = next.find((w) => !w.minimized && !w.maximized && w.key !== keepKey)
    if (!victim) break
    next = next.map((w) => (w === victim ? { ...w, minimized: true } : w))
  }
  return next
}

/**
 * Floating compose windows (up to 3) for the mailbox.
 *
 * accounts: accountItem[] from GET /api/mail/accounts — the only From options.
 * onSent(data): after POST /api/mail/send succeeds — data = { id, status, sendAt, scheduled, accountId }.
 * onDraftSaved(info): after a draft save/discard — info = { draftId, accountId, deleted? }.
 */
export function ComposerProvider({ accounts = [], defaultAccountId, onSent, onDraftSaved, children }) {
  const [windows, setWindows] = useState([])
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const handlesRef = useRef(new Map())
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const defaultRef = useRef(defaultAccountId)
  defaultRef.current = defaultAccountId
  const callbacks = useRef({})
  callbacks.current = { onSent, onDraftSaved }
  const openRef = useRef(null)
  const recoveredRef = useRef(false)

  const remove = useCallback((key) => {
    windowsRef.current = windowsRef.current.filter((w) => w.key !== key)
    setWindows((ws) => ws.filter((w) => w.key !== key))
  }, [])

  const setMinimized = useCallback((key, minimized) => {
    setWindows((ws) => fitToViewport(
      ws.map((w) => (w.key === key ? { ...w, minimized, maximized: minimized ? false : w.maximized } : w)),
      key
    ))
  }, [])

  const toggleMaximize = useCallback((key) => {
    setWindows((ws) => fitToViewport(
      ws.map((w) => (w.key === key ? { ...w, maximized: !w.maximized, minimized: false } : { ...w, maximized: false })),
      key
    ))
  }, [])

  const register = useCallback((key, handle) => {
    handlesRef.current.set(key, handle)
    return () => {
      if (handlesRef.current.get(key) === handle) handlesRef.current.delete(key)
    }
  }, [])

  const open = useCallback((opts = {}) => {
    const o = opts || {}
    const current = windowsRef.current

    // The same draft is already open → bring it forward instead of duplicating it.
    const draftId = o.mode === 'draft' ? (o.source?.id || o.draftId) : o.draftId
    if (draftId) {
      const existing = current.find((w) => (
        String(handlesRef.current.get(w.key)?.getDraftId?.() || '') === String(draftId) || w.init.draftId === String(draftId)
      ))
      if (existing) {
        setMinimized(existing.key, false)
        handlesRef.current.get(existing.key)?.focus?.()
        return existing.key
      }
    }
    if (o.key && current.some((w) => w.key === o.key)) return o.key

    const init = buildInitialState(o, { accounts: accountsRef.current, defaultAccountId: defaultRef.current })
    const key = o.key || uid()

    // At the limit the oldest window (minimised first) closes — it saves its draft.
    let evicted = null
    if (current.length >= MAX_WINDOWS) {
      evicted = current.find((w) => w.minimized) || current[0]
      const h = handlesRef.current.get(evicted.key)
      if (h) h.close()
      else remove(evicted.key)
    }

    const entry = { key, init, minimized: !!o.minimized, maximized: false }
    windowsRef.current = [...windowsRef.current.filter((w) => w.key !== evicted?.key), entry]
    setWindows((ws) => fitToViewport([...ws.filter((w) => w.key !== evicted?.key && w.key !== key), entry], key))
    return key
  }, [remove, setMinimized])
  openRef.current = open

  const closeAll = useCallback(() => {
    for (const w of [...windowsRef.current]) {
      const h = handlesRef.current.get(w.key)
      if (h) h.close()
      else remove(w.key)
    }
  }, [remove])

  const undoSend = useCallback(async (outboxId, snapshot, toastId) => {
    toast.dismiss(toastId)
    try {
      const data = await mailApi(`/api/mail/outbox/${outboxId}`, { method: 'DELETE' })
      // Local snapshot keeps chip metadata and the trimmed quote; server payload is the fallback.
      openRef.current?.({ ...(data?.payload || {}), ...snapshot, restore: true, dirty: true })
      toast('Sending undone')
    } catch (err) {
      toast.error(err?.message || 'Too late to undo')
    }
  }, [])

  const handleSent = useCallback(({ data, snapshot, sendAt, startedAt }) => {
    callbacks.current.onSent?.(data)
    const outboxId = data?.id
    if (!outboxId || data?.status === 'SENT') { toast.success('Message sent'); return }
    const scheduled = !!(data?.scheduled || sendAt)
    const when = data?.sendAt ? new Date(data.sendAt) : sendAt
    const seconds = scheduled
      ? 8
      : Math.max(1, MAIL_LIMITS.undoSendSeconds - Math.round((Date.now() - (startedAt || Date.now())) / 1000))
    const label = scheduled ? `Scheduled for ${formatScheduled(when || sendAt)}` : 'Sending…'
    const id = `mail-outbox-${outboxId}`
    toast.custom(
      (t) => <UndoToast t={t} label={label} seconds={seconds} countdown={!scheduled} onUndo={() => undoSend(outboxId, snapshot, id)} />,
      { id, duration: seconds * 1000 }
    )
  }, [undoSend])

  const handleDraftSaved = useCallback((info) => { callbacks.current.onDraftSaved?.(info) }, [])

  // Crash recovery: composers with unsaved changes left in localStorage reopen minimised.
  useEffect(() => {
    if (recoveredRef.current || !accounts.length) return
    recoveredRef.current = true
    for (const { key, data } of readRecoverableMirrors().slice(0, MAX_WINDOWS)) {
      open({ ...data, key, restore: true, dirty: true, minimized: true })
    }
  }, [accounts, open])

  const value = useMemo(() => ({ open, closeAll }), [open, closeAll])
  const maximized = windows.find((w) => w.maximized && !w.minimized)

  return (
    <ComposerContext.Provider value={value}>
      {children}
      {windows.length > 0 && typeof document !== 'undefined' && createPortal(
        <Tooltip.Provider delayDuration={400} skipDelayDuration={150}>
          <div className="pointer-events-none fixed bottom-0 right-0 z-[45] flex max-w-full flex-row-reverse items-end gap-3 px-2 sm:right-4 sm:px-0">
            {maximized && (
              <div
                aria-hidden
                onClick={() => toggleMaximize(maximized.key)}
                className="pointer-events-auto fixed inset-0 z-[46] hidden bg-black/40 backdrop-blur-[2px] animate-in fade-in-0 duration-150 sm:block"
              />
            )}
            {windows.map((w) => (
              <ComposerWindow
                key={w.key}
                win={w}
                accounts={accounts}
                setMinimized={setMinimized}
                toggleMaximize={toggleMaximize}
                onRemove={remove}
                register={register}
                onSent={handleSent}
                onDraftSaved={handleDraftSaved}
              />
            ))}
          </div>
        </Tooltip.Provider>,
        document.body
      )}
    </ComposerContext.Provider>
  )
}

/** → { open(opts), closeAll() } */
export function useComposer() {
  return useContext(ComposerContext) ?? FALLBACK
}

export default ComposerProvider
