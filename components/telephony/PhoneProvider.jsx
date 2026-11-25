'use client'

/**
 * The CRM's phone (Envo), for staff with an extension (Configuration → Calling).
 *
 *   const phone = usePhone()          // null when this person has no phone
 *   phone.callTarget({ type: 'client', id, field: 'phone' }, 'Acme Ltd')
 *   phone.dial('01712345678')
 *
 * The engine (./engine.js) keeps one registration across all of the person's tabs;
 * this provider shows it (./Softphone.jsx) and offers the actions. Mounted in the admin
 * layout, it lives across page changes, so a call survives navigating the CRM.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import { PhoneEngine } from './engine'
import Softphone from './Softphone'

const PhoneContext = createContext(null)

/** The phone, or null when this person cannot call (no extension, not staff, calling off). */
export const usePhone = () => useContext(PhoneContext)

const STAFF = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
const noop = () => () => {}

/** Whether the phone is (or within a few seconds becomes) registered with Envo. */
function whenOnline(engine, ms = 6000) {
  return new Promise((resolve) => {
    const reg = () => engine.getSnapshot()?.reg
    if (reg() === 'registered') return resolve(true)
    if (reg() !== 'connecting') return resolve(false)
    let unsub = () => {}
    const timer = setTimeout(() => { unsub(); resolve(reg() === 'registered') }, ms)
    unsub = engine.subscribe(() => {
      if (reg() === 'registered' || reg() === 'failed') { clearTimeout(timer); unsub(); resolve(reg() === 'registered') }
    })
  })
}

function notify(kind, message) {
  if (kind === 'error') toast.error(message, { id: `phone:${message}` })
  else if (kind === 'success') toast.success(message)
  else toast(message)
}

export default function PhoneProvider({ children }) {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const userId = session?.user?.id
  const [me, setMe] = useState(null)
  const [engine, setEngine] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated' || !STAFF.includes(role)) { setMe(null); return }
    let cancelled = false
    fetch('/api/telephony/me')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled) setMe(j?.data ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [status, role, userId])

  useEffect(() => {
    if (!me?.enabled || !me.userId) return undefined
    const e = new PhoneEngine({ userId: me.userId, extension: me.extension, onNotice: notify })
    e.start()
    setEngine(e)
    return () => { e.stop(); setEngine(null) }
  }, [me?.enabled, me?.userId, me?.extension])

  const subscribe = useCallback((fn) => (engine ? engine.subscribe(fn) : noop()), [engine])
  const getSnapshot = useCallback(() => (engine ? engine.getSnapshot() : null), [engine])
  const state = useSyncExternalStore(subscribe, getSnapshot, () => null)

  // A call coming in, or one just placed, brings the panel up.
  const callId = state?.call?.id
  useEffect(() => { if (callId) setPanelOpen(true) }, [callId])

  /** Envo rings every phone on the person's extension, then dials once they pick up. */
  const ringMyPhone = useCallback(async ({ to, target, label }) => {
    try {
      const res = await fetch('/api/telephony/originate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target ? { target } : { to }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Envo could not start the call')
      toast.success(`Envo is ringing your phone (ext ${j.data.extension}): pick up to call ${label || j.data.display || to}`, { duration: 6000 })
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }, [])

  const online = state?.reg === 'registered'

  const dial = useCallback(async (number, meta = {}) => {
    if (!engine) return false
    if (!(await whenOnline(engine))) {
      // The browser phone is offline (Envo unreachable, blocked network): use the person's other phones.
      toast('The browser phone is not connected: ringing your other phones instead')
      return ringMyPhone({ to: number, label: meta.label })
    }
    setPanelOpen(true)
    return engine.dial(number, meta)
  }, [engine, ringMyPhone])

  /** Call the number stored on a record ({ type: 'client'|'lead', id, field }), shown masked or not. */
  const callTarget = useCallback(async (target, label) => {
    if (!engine) return false
    if (!(await whenOnline(engine))) {
      toast('The browser phone is not connected: ringing your other phones instead')
      return ringMyPhone({ target, label })
    }
    try {
      const res = await fetch('/api/telephony/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'There is no number to call')
      setPanelOpen(true)
      return engine.dial(j.data.number, { display: j.data.display, label: j.data.name || label })
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }, [engine, ringMyPhone])

  const value = useMemo(() => {
    if (!engine || !state) return null
    return {
      state,
      extension: state.extension,
      online,
      panelOpen,
      setPanelOpen,
      togglePanel: () => setPanelOpen(o => !o),
      dial,
      callTarget,
      ringMyPhone,
      answer: () => engine.answer(),
      hangup: () => engine.hangup(),
      toggleMute: () => engine.toggleMute(),
      toggleHold: () => engine.toggleHold(),
      dtmf: (d) => engine.dtmf(d),
      transfer: (to, display) => engine.transfer(to, display),
      reconnect: () => engine.reconnect(),
      setLabel: (id, label) => engine.setLabel(id, label),
      allowMicrophone: () => engine.ensureMic(),
      clearHistory: () => engine.clearHistory(),
    }
  }, [engine, state, online, panelOpen, dial, callTarget, ringMyPhone])

  return (
    <PhoneContext.Provider value={value}>
      {children}
      {value && <Softphone />}
    </PhoneContext.Provider>
  )
}
