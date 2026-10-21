'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { mailApi } from './composeUtils'

/**
 * Debounced server draft autosave. Saves are strictly serialised (each one
 * replaces the previous draftId on the server), so callers can `flush()` or
 * `waitIdle()` and then trust `getDraftId()`.
 *
 * getPayload({ draftId }) → compose payload, or null when there's nothing worth saving.
 * beforeSave() → optional promise awaited before building the payload.
 */
export function useDraftAutosave({ initialDraftId = null, initialDirty = false, getPayload, beforeSave, onSaved, delay = 10000 }) {
  const [status, setStatus] = useState('idle') // idle | saving | saved | error
  const draftIdRef = useRef(initialDraftId)
  const dirtyRef = useRef(initialDirty)
  const versionRef = useRef(0)
  const timerRef = useRef(null)
  const chainRef = useRef(Promise.resolve())
  const mountedRef = useRef(true)
  const fns = useRef({})
  fns.current = { getPayload, beforeSave, onSaved }

  const setStatusSafe = useCallback((s) => { if (mountedRef.current) setStatus(s) }, [])

  const saveOnce = useCallback(async () => {
    if (!dirtyRef.current) return draftIdRef.current
    if (fns.current.beforeSave) await fns.current.beforeSave()
    const payload = fns.current.getPayload?.({ draftId: draftIdRef.current })
    if (!payload) { dirtyRef.current = false; return draftIdRef.current }
    const version = versionRef.current
    dirtyRef.current = false
    setStatusSafe('saving')
    try {
      const body = { ...payload }
      if (draftIdRef.current) body.draftId = draftIdRef.current
      const data = await mailApi('/api/mail/drafts', { method: 'POST', body })
      if (data?.draftId) draftIdRef.current = String(data.draftId)
      setStatusSafe(versionRef.current === version ? 'saved' : 'idle')
      fns.current.onSaved?.({ draftId: draftIdRef.current, accountId: payload.accountId, dirty: dirtyRef.current })
      return draftIdRef.current
    } catch (err) {
      dirtyRef.current = true
      setStatusSafe('error')
      throw err
    }
  }, [setStatusSafe])

  const flush = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    const run = chainRef.current.catch(() => {}).then(saveOnce)
    chainRef.current = run
    return run
  }, [saveOnce])

  const schedule = useCallback((ms = delay) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flush().catch(() => {
        // Retry once more later; the status line already says it failed.
        if (mountedRef.current && dirtyRef.current) schedule(ms * 2)
      })
    }, ms)
  }, [delay, flush])

  const markDirty = useCallback(() => {
    versionRef.current += 1
    dirtyRef.current = true
    schedule()
  }, [schedule])

  const cancel = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const waitIdle = useCallback(() => chainRef.current.catch(() => {}), [])
  const isDirty = useCallback(() => dirtyRef.current, [])
  const getDraftId = useCallback(() => draftIdRef.current, [])

  // Restored/recovered composers start dirty. Deps are stable → mount/unmount only.
  const startDirtyRef = useRef(initialDirty)
  useEffect(() => {
    mountedRef.current = true
    if (startDirtyRef.current && dirtyRef.current) schedule()
    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
    }
  }, [schedule])

  return { status, markDirty, flush, schedule, cancel, waitIdle, isDirty, getDraftId }
}

export default useDraftAutosave
