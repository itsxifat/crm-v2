'use client'

/**
 * The phone's window: a dialpad with contact search and recent calls, and during a call
 * the controls with the caller's details from the CRM. Minimised to a pill while a call
 * goes on. Stays usable over open dialogs (components/ui/Modal.jsx exempts data-crm-phone).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, PhoneMissed, Mic, MicOff, Pause, Play, Grid3x3, ArrowRightLeft,
  X, ChevronDown, Delete, Loader2, RefreshCw, AlertTriangle, Smartphone, History, Building2, UserRound, Headset,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePhone } from './PhoneProvider'
import CallerDetails, { useCallerLookup, forgetLookup, mmss } from './CallerDetails'
import { formatNumber, dialable } from '@/lib/telephony/numbers'

const LeadModal = dynamic(() => import('@/components/admin/leads/LeadModal'), { ssr: false })

const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
]

const REG = {
  registered: { dot: 'bg-emerald-500', text: 'Online' },
  connecting: { dot: 'bg-amber-400 animate-pulse', text: 'Connecting…' },
  failed:     { dot: 'bg-red-500', text: 'Offline' },
  off:        { dot: 'bg-gray-300', text: 'Off' },
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Keypad({ onKey, compact = false }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map(([k, sub]) => (
        <button key={k} type="button" onClick={() => onKey(k)}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl bg-gray-50 text-gray-900 transition-[background-color,transform] hover:bg-gray-100 active:scale-95',
            compact ? 'h-11' : 'h-12',
          )}>
          <span className="text-lg font-medium leading-none">{k}</span>
          <span className="mt-0.5 h-2.5 text-[8.5px] font-medium tracking-[0.18em] text-gray-400">{sub}</span>
        </button>
      ))}
    </div>
  )
}

function RoundButton({ tone, onClick, label, children, disabled, size = 'lg' }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
        className={cn(
          'flex items-center justify-center rounded-full text-white shadow-lg transition-[transform,filter] hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
          size === 'lg' ? 'size-14 [&_svg]:size-6' : 'size-11 [&_svg]:size-5',
          tone === 'green' ? 'bg-emerald-500 shadow-emerald-500/25' : 'bg-red-500 shadow-red-500/25',
        )}>
        {children}
      </button>
      {size === 'lg' && <span className="text-[11px] text-muted-foreground">{label}</span>}
    </div>
  )
}

function Control({ on, onClick, icon: Icon, label, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[11px] font-medium transition-colors disabled:opacity-40',
        on ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100',
      )}>
      <Icon className="size-[18px]" />
      {label}
    </button>
  )
}

function Avatar({ name, ringing }) {
  const initial = (name || '').trim().slice(0, 1).toUpperCase()
  // A bare number (nobody in the CRM): a person, not its first digit.
  const known = /[A-Z]/.test(initial)
  return (
    <div className={cn(
      'mx-auto flex size-14 items-center justify-center rounded-full text-xl font-semibold text-white',
      known ? 'bg-gradient-to-br from-brand-400 to-brand-700' : 'bg-gradient-to-br from-gray-400 to-gray-600',
      ringing && 'animate-[phone-ring_1.4s_ease-out_infinite]',
    )}>
      {known ? initial : <UserRound className="size-6" />}
    </div>
  )
}

function useTicker(active) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const t = window.setInterval(() => setTick(n => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [active])
}

/** Debounced /api/telephony/search. */
function useContactSearch(query) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const q = query.trim()
    if (q.replace(/[+\s]/g, '').length < 2) { setResults([]); setLoading(false); return undefined }
    let live = true
    setLoading(true)
    const t = window.setTimeout(() => {
      fetch(`/api/telephony/search?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : { data: [] }))
        .then(j => { if (live) setResults(j.data ?? []) })
        .catch(() => { if (live) setResults([]) })
        .finally(() => { if (live) setLoading(false) })
    }, 250)
    return () => { live = false; window.clearTimeout(t) }
  }, [query])
  return { results, loading }
}

const TYPE_ICON = { client: Building2, lead: UserRound, staff: Headset }

function ContactResults({ results, onCall }) {
  if (!results.length) return null
  return (
    <ul className="mb-3 max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200/80">
      {results.map(r => {
        const Icon = TYPE_ICON[r.type] ?? UserRound
        return (
          <li key={`${r.type}:${r.id}`} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <Icon className="size-3.5 shrink-0 text-gray-400" />
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-900">{r.name}</p>
              <span className="shrink-0 text-[11px] text-muted-foreground">{r.detail}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
              {r.numbers.map(n => (
                <button key={n.field} type="button" onClick={() => onCall(r, n)}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/15 hover:bg-emerald-100">
                  <Phone className="size-3" />
                  <span className="text-emerald-700/70">{n.label}</span>
                  <span className="tabular-nums">{n.display}</span>
                </button>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const HISTORY_ICON = { answered: null, missed: PhoneMissed, declined: PhoneMissed, failed: PhoneMissed, cancelled: PhoneMissed }

function when(at) {
  const t = new Date(at)
  const today = new Date()
  if (t.toDateString() === today.toDateString()) return t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function RecentList({ history, onCall, onClear }) {
  if (!history.length) {
    return (
      <div className="py-10 text-center">
        <History className="mx-auto size-5 text-gray-300" />
        <p className="mt-2 text-[13px] text-muted-foreground">Calls you make and take in this browser show here.</p>
      </div>
    )
  }
  return (
    <div>
      <ul className="max-h-[22rem] divide-y divide-gray-100 overflow-y-auto">
        {history.map(h => {
          const missed = h.status !== 'answered'
          const Icon = HISTORY_ICON[h.status] ?? (h.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing)
          const who = h.label || h.name || h.display || formatNumber(h.number)
          return (
            <li key={h.id}>
              <button type="button" onClick={() => onCall(h)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-gray-50">
                <Icon className={cn('size-4 shrink-0', missed && h.direction === 'incoming' ? 'text-red-500' : 'text-gray-400')} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[13px] font-medium', missed && h.direction === 'incoming' ? 'text-red-600' : 'text-gray-900')}>{who}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {who !== (h.display || formatNumber(h.number)) ? `${h.display || formatNumber(h.number)} · ` : ''}
                    {h.status === 'answered' ? mmss(h.duration) : h.status}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{when(h.at)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-1 text-right">
        <button type="button" onClick={onClear} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-gray-100 hover:text-gray-900">Clear</button>
      </div>
    </div>
  )
}

// ── Dialer ───────────────────────────────────────────────────────────────────

function Dialer({ phone }) {
  const { state } = phone
  const [tab, setTab] = useState('keypad')
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const { results, loading } = useContactSearch(query)
  const number = dialable(query)
  const isNumber = !!number && number.replace(/\D/g, '').length >= 2 && !/[a-z]/i.test(query)

  useEffect(() => { if (tab === 'keypad') inputRef.current?.focus() }, [tab])

  function press(k) {
    setQuery(q => q + k)
    inputRef.current?.focus()
  }

  function callContact(r, n) {
    if (n.dial) phone.dial(n.dial, { label: r.name })
    else phone.callTarget({ type: r.type, id: r.id, field: n.field }, r.name)
    setQuery('')
  }

  function callTyped() {
    if (isNumber) { phone.dial(number); setQuery(''); return }
    const first = results[0]
    if (first?.numbers?.[0]) callContact(first, first.numbers[0])
  }

  return (
    <div className="px-4 pb-4">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-0.5 text-[13px] font-medium">
        {[['keypad', 'Keypad'], ['recent', 'Recent']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn('rounded-md py-1.5 transition-colors', tab === k ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900')}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'recent' ? (
        <RecentList history={state.history}
          onCall={(h) => phone.dial(h.number, { display: h.display, label: h.label || h.name })}
          onClear={phone.clearHistory} />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-1.5">
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') callTyped() }}
              placeholder="Name or number" inputMode="tel" autoComplete="off" spellCheck={false}
              aria-label="Name or number to call"
              className="h-11 min-w-0 flex-1 border-0 bg-transparent p-0 text-center text-2xl font-light tracking-wide text-gray-900 shadow-none outline-none focus:ring-0 placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-400" />
            {loading && <Loader2 className="size-4 shrink-0 animate-spin text-gray-300" />}
            {query && (
              <button type="button" onClick={() => setQuery(q => q.slice(0, -1))} onDoubleClick={() => setQuery('')}
                aria-label="Delete" title="Delete (double-click to clear)"
                className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900">
                <Delete className="size-5" />
              </button>
            )}
          </div>

          <ContactResults results={results} onCall={callContact} />
          {!results.length && <Keypad onKey={press} />}

          <div className="mt-4 flex items-start justify-center gap-6">
            <RoundButton tone="green" label="Call" onClick={callTyped}
              disabled={!isNumber && !results[0]?.numbers?.length}>
              <Phone />
            </RoundButton>
          </div>
          {isNumber && (
            <div className="mt-2 text-center">
              <button type="button" onClick={() => phone.ringMyPhone({ to: number })}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-gray-100 hover:text-gray-900"
                title="Envo rings your desk phone and apps first, then dials this number">
                <Smartphone className="size-3.5" /> Use my desk phone instead
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── During a call ────────────────────────────────────────────────────────────

function CallView({ phone, call, lookup, onAddLead }) {
  const [view, setView] = useState('main') // main | keypad | transfer
  const [xfer, setXfer] = useState('')
  const { results: xferResults } = useContactSearch(view === 'transfer' ? xfer : '')
  const staff = xferResults.filter(r => r.type === 'staff')
  useTicker(call.state === 'active')

  const first = lookup.matches?.[0]
  useEffect(() => {
    if (first?.title && !call.label) phone.setLabel(call.id, first.title)
  }, [first?.title, call.id, call.label]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (call.state !== 'active') setView('main') }, [call.state])

  const title = call.label || first?.title || call.name || call.display || formatNumber(call.number) || 'Unknown'
  const shownNumber = call.display || formatNumber(call.number)
  const ringing = call.state === 'ringing'
  const talk = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0
  const status = ringing ? (call.callback ? 'Your click-to-call: answer to dial' : 'Incoming call')
    : call.state === 'dialing' ? 'Calling…'
      : call.state === 'progress' ? 'Ringing…'
        : call.state === 'ended' ? (call.endReason || `Call ended · ${mmss(talk)}`)
          : `${call.held ? 'On hold · ' : ''}${mmss(talk)}`

  return (
    <>
      <div className="px-4 pb-4 pt-2 text-center">
        <Avatar name={title} ringing={ringing} />
        <p className="mt-3 truncate text-lg font-semibold text-gray-900">{title}</p>
        {title !== shownNumber && <p className="truncate text-[13px] text-muted-foreground tabular-nums">{shownNumber}</p>}
        <p className={cn('mt-1 text-[13px] font-medium tabular-nums', ringing ? 'text-emerald-600' : call.state === 'ended' ? 'text-gray-500' : 'text-brand')}>
          {status}
        </p>

        {view === 'keypad' && call.state === 'active' ? (
          <div className="mt-4">
            <Keypad compact onKey={(k) => phone.dtmf(k)} />
            <button type="button" onClick={() => setView('main')} className="mt-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-gray-100">Hide keypad</button>
          </div>
        ) : view === 'transfer' && call.state === 'active' ? (
          <div className="mt-4 text-left">
            <input value={xfer} onChange={e => setXfer(e.target.value)} autoFocus placeholder="Colleague, extension or number"
              onKeyDown={e => { if (e.key === 'Enter' && dialable(xfer)) { phone.transfer(xfer); setView('main') } }}
              className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
            {staff.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto">
                {staff.map(s => (
                  <li key={s.id}>
                    <button type="button" onClick={() => { phone.transfer(s.numbers[0].dial, s.name); setView('main') }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-gray-50">
                      <Headset className="size-3.5 text-gray-400" />
                      <span className="flex-1 truncate font-medium text-gray-900">{s.name}</span>
                      <span className="text-xs text-muted-foreground">ext {s.numbers[0].display}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setView('main')} className="h-8 flex-1 rounded-md bg-gray-100 text-[13px] font-medium text-gray-700 hover:bg-gray-200">Cancel</button>
              <button type="button" disabled={!dialable(xfer)} onClick={() => { phone.transfer(xfer); setView('main') }}
                className="h-8 flex-1 rounded-md bg-gray-900 text-[13px] font-medium text-white hover:bg-gray-800 disabled:opacity-40">Transfer</button>
            </div>
          </div>
        ) : call.state === 'active' ? (
          <div className="mt-4 grid grid-cols-4 gap-2">
            <Control on={call.muted} onClick={phone.toggleMute} icon={call.muted ? MicOff : Mic} label={call.muted ? 'Unmute' : 'Mute'} />
            <Control on={call.held} onClick={phone.toggleHold} icon={call.held ? Play : Pause} label={call.held ? 'Resume' : 'Hold'} />
            <Control onClick={() => setView('keypad')} icon={Grid3x3} label="Keypad" />
            <Control onClick={() => setView('transfer')} icon={ArrowRightLeft} label="Transfer" />
          </div>
        ) : null}

        <div className="mt-5 flex items-start justify-center gap-10">
          {ringing ? (
            <>
              <RoundButton tone="red" label="Decline" onClick={phone.hangup}><PhoneOff /></RoundButton>
              <RoundButton tone="green" label="Answer" onClick={phone.answer}><Phone /></RoundButton>
            </>
          ) : call.state !== 'ended' ? (
            <RoundButton tone="red" label="Hang up" onClick={phone.hangup}><PhoneOff /></RoundButton>
          ) : null}
        </div>
      </div>

      <CallerDetails number={call.number} lookup={lookup} onAddLead={onAddLead} />
    </>
  )
}

function CallPill({ phone, call, title, onOpen }) {
  useTicker(call.state === 'active')
  const ringing = call.state === 'ringing'
  const talk = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0
  return (
    <div data-crm-phone
      className="pointer-events-auto fixed bottom-4 right-4 z-[70] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border border-gray-200/80 bg-white py-1.5 pl-4 pr-1.5 shadow-xl">
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2.5 text-left">
        <span className={cn('size-2 shrink-0 rounded-full', ringing ? 'animate-pulse bg-emerald-500' : 'bg-brand')} />
        <span className="min-w-0">
          <span className="block max-w-[11rem] truncate text-[13px] font-semibold text-gray-900">{title}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">
            {ringing ? 'Incoming call' : call.state === 'active' ? `${call.held ? 'On hold · ' : ''}${mmss(talk)}` : call.state === 'ended' ? 'Call ended' : 'Calling…'}
          </span>
        </span>
      </button>
      {ringing && <RoundButton size="sm" tone="green" label="Answer" onClick={phone.answer}><Phone /></RoundButton>}
      {call.state !== 'ended' && <RoundButton size="sm" tone="red" label={ringing ? 'Decline' : 'Hang up'} onClick={phone.hangup}><PhoneOff /></RoundButton>}
    </div>
  )
}

/** While a call rings, the tab title says so: the person may be on another tab. */
function useRingingTitle(ringing, who) {
  useEffect(() => {
    if (!ringing) return undefined
    const original = document.title
    let flip = false
    const t = window.setInterval(() => {
      flip = !flip
      document.title = flip ? `📞 ${who || 'Incoming call'}` : original
    }, 1000)
    return () => { window.clearInterval(t); document.title = original }
  }, [ringing, who])
}

// ── The window ───────────────────────────────────────────────────────────────

export default function Softphone() {
  const phone = usePhone()
  const [leadFor, setLeadFor] = useState(null)
  const state = phone?.state
  const call = state?.call ?? null
  const lookup = useCallerLookup(call?.number ?? '')
  const title = useMemo(() => (
    call ? (call.label || lookup.matches?.[0]?.title || call.name || call.display || formatNumber(call.number)) : ''
  ), [call, lookup.matches])
  useRingingTitle(call?.direction === 'incoming' && call?.state === 'ringing', title)

  // Escape closes an idle dialer.
  useEffect(() => {
    if (!phone?.panelOpen || call) return undefined
    const onKey = (e) => {
      const at = document.activeElement
      if (e.key === 'Escape' && (!at || at === document.body || at.closest?.('[data-crm-phone]'))) phone.setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phone?.panelOpen, call]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!phone || !state) return null
  const reg = REG[state.reg] ?? REG.off

  const leadModal = leadFor && (
    <LeadModal open lead={null} prefill={{ phone: dialable(leadFor) || leadFor }}
      onClose={() => { setLeadFor(null); phone.setPanelOpen(true) }}
      onSuccess={() => forgetLookup(leadFor)} />
  )
  const addLead = (number) => { setLeadFor(number); phone.setPanelOpen(false) }

  if (!phone.panelOpen) {
    return (
      <>
        {call && <CallPill phone={phone} call={call} title={title} onOpen={() => phone.setPanelOpen(true)} />}
        {leadModal}
      </>
    )
  }

  return (
    <>
      <div data-crm-phone role="dialog" aria-label="Phone"
        className="pointer-events-auto fixed inset-x-3 bottom-3 z-[70] flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl animate-in fade-in-0 slide-in-from-bottom-2 duration-150 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[380px] sm:max-h-[calc(100dvh-5rem)]">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <span className={cn('size-2 rounded-full', reg.dot)} />
              {call ? (call.direction === 'incoming' ? 'Incoming call' : 'Outgoing call') : 'Phone'}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Ext {state.extension} · {reg.text}{state.role === 'follower' ? ' · in another tab' : ''}
            </p>
          </div>
          <button type="button" onClick={() => phone.setPanelOpen(false)}
            aria-label={call ? 'Minimise' : 'Close'} title={call ? 'Minimise' : 'Close'}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900">
            {call ? <ChevronDown className="size-4" /> : <X className="size-4" />}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!call && state.reg === 'failed' && (
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{state.regError || 'The phone is not connected to Envo.'} Calls ring your desk phone meanwhile.</span>
              <button type="button" onClick={phone.reconnect} title="Try again" aria-label="Try again"
                className="shrink-0 rounded-md p-0.5 text-red-700 hover:bg-red-100"><RefreshCw className="size-4" /></button>
            </div>
          )}
          {!call && state.micPermission === 'denied' && (
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              <MicOff className="mt-0.5 size-4 shrink-0" />
              <span>The microphone is blocked for this site. Allow it from the icon at the left of the address bar, then reload.</span>
            </div>
          )}
          {!call && state.micPermission === 'prompt' && (
            <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-700">
              <Mic className="size-4 shrink-0 text-gray-500" />
              <span className="flex-1">Allow the microphone once, so calls connect straight away.</span>
              <button type="button" onClick={() => {
                phone.allowMicrophone()
                if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
              }} className="shrink-0 rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800">Allow</button>
            </div>
          )}

          {call
            ? <CallView key={call.id} phone={phone} call={call} lookup={lookup} onAddLead={addLead} />
            : <Dialer phone={phone} />}
        </div>
      </div>
      {leadModal}
    </>
  )
}
