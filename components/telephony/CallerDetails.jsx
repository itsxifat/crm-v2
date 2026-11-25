'use client'

/**
 * Who is on the line: the clients, leads and colleagues behind a number
 * (/api/telephony/lookup) and the last calls with it (/api/telephony/history).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Building2, UserRound, Headset, ExternalLink, PhoneIncoming, PhoneOutgoing, PhoneMissed, UserPlus, Loader2,
  AlertTriangle, StickyNote,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import { usePermission } from '@/components/auth/Can'
import { formatNumber } from '@/lib/telephony/numbers'

// Answers per number for a couple of minutes: the panel re-renders, the number does not change.
const lookups = new Map()
const histories = new Map()
const FRESH_MS = 120_000

function cached(map, key, load) {
  const hit = map.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise
  const promise = load().catch((err) => { map.delete(key); throw err })
  map.set(key, { at: Date.now(), promise })
  if (map.size > 200) map.delete(map.keys().next().value)
  return promise
}

async function getJson(url) {
  const res = await fetch(url)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
  return j.data
}

const FORGET = 'crm-phone:lookup-changed'

/** After the CRM learns something about a number (a lead was added): panels showing it look again. */
export function forgetLookup(number) {
  lookups.delete(number)
  window.dispatchEvent(new CustomEvent(FORGET, { detail: number }))
}

/** { matches, loading, error, reload } for a number. */
export function useCallerLookup(number) {
  const [state, setState] = useState({ matches: null, loading: !!number, error: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const onForget = (e) => { if (e.detail === number) setNonce(n => n + 1) }
    window.addEventListener(FORGET, onForget)
    return () => window.removeEventListener(FORGET, onForget)
  }, [number])
  useEffect(() => {
    if (!number) { setState({ matches: [], loading: false, error: null }); return undefined }
    let live = true
    setState(s => ({ ...s, loading: true, error: null }))
    cached(lookups, number, () => getJson(`/api/telephony/lookup?number=${encodeURIComponent(number)}`))
      .then(d => { if (live) setState({ matches: d.matches ?? [], loading: false, error: null }) })
      .catch(err => { if (live) setState({ matches: [], loading: false, error: err.message }) })
    return () => { live = false }
  }, [number, nonce])
  return { ...state, reload: () => { lookups.delete(number); setNonce(n => n + 1) } }
}

function useCallHistory(number) {
  const [state, setState] = useState({ calls: null, error: null })
  useEffect(() => {
    if (!number || number.replace(/\D/g, '').length < 7) { setState({ calls: [], error: null }); return undefined }
    let live = true
    cached(histories, number, () => getJson(`/api/telephony/history?number=${encodeURIComponent(number)}`))
      .then(d => { if (live) setState({ calls: d.calls ?? [], error: null }) })
      .catch(err => { if (live) setState({ calls: [], error: err.message }) })
    return () => { live = false }
  }, [number])
  return state
}

// ── Formatting ───────────────────────────────────────────────────────────────

const tk = (n) => `৳ ${Math.round(Number(n) || 0).toLocaleString('en-BD')}`
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : null)
function when(d) {
  const t = new Date(d)
  const today = new Date()
  const sameDay = t.toDateString() === today.toDateString()
  return sameDay
    ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' })
    : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' })
}
export const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
const label = (s) => String(s ?? '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())

const TYPE = {
  client: { icon: Building2, name: 'Client', tone: 'bg-blue-50 text-blue-700' },
  lead:   { icon: UserRound, name: 'Lead',   tone: 'bg-violet-50 text-violet-700' },
  staff:  { icon: Headset,   name: 'Colleague', tone: 'bg-gray-100 text-gray-700' },
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Fact({ name, value, tone }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">{name}</p>
      <p className={cn('mt-0.5 truncate text-[13px] font-semibold tabular-nums text-gray-900', tone)}>{value}</p>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">{title}</p>
      {children}
    </div>
  )
}

function Row({ href, children }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-gray-50">
      {children}
    </Link>
  )
}

function ClientBody({ m }) {
  const money = m.money
  return (
    <>
      <div className={cn('mt-3 grid gap-2', money ? 'grid-cols-3' : 'grid-cols-2')}>
        {money && <Fact name="Outstanding" value={tk(money.outstanding)} tone={money.outstanding > 0 ? 'text-red-600' : null} />}
        {money && <Fact name="Revenue" value={tk(money.revenue)} />}
        {m.projects && <Fact name="Active projects" value={`${m.projects.active}${m.projects.total ? ` of ${m.projects.total}` : ''}`} />}
        {!money && m.industry && <Fact name="Industry" value={m.industry} />}
      </div>
      {money?.invoices?.length > 0 && (
        <Section title={`Unpaid invoices${money.overdue ? ` · ${money.overdue} overdue` : ''}`}>
          {money.invoices.map(i => (
            <Row key={i.id} href={`/admin/invoices/${i.id}`}>
              <span className="font-mono text-xs text-gray-900">{i.number || 'Invoice'}</span>
              <Badge status={i.status} />
              <span className="ml-auto tabular-nums font-medium text-gray-900">{tk(i.due)}</span>
            </Row>
          ))}
          {money.openInvoices > money.invoices.length && (
            <p className="px-1.5 pt-0.5 text-xs text-muted-foreground">and {money.openInvoices - money.invoices.length} more</p>
          )}
        </Section>
      )}
      {m.projects?.items?.length > 0 && (
        <Section title={m.projects.active ? 'Active projects' : 'Projects'}>
          {m.projects.items.map(p => (
            <Row key={p.id} href={`/admin/projects/${p.id}`}>
              <span className="min-w-0 flex-1 truncate text-gray-900">{p.name}</span>
              <Badge status={p.status} />
            </Row>
          ))}
        </Section>
      )}
    </>
  )
}

function LeadBody({ m }) {
  const facts = [
    m.service && ['Service', m.service],
    m.source && ['Source', m.source],
    m.value != null && ['Value', tk(m.value)],
    m.followUpDate && ['Follow-up', day(m.followUpDate)],
    m.assignedTo && ['Assigned to', m.assignedTo],
  ].filter(Boolean)
  return (
    <>
      {facts.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {facts.slice(0, 4).map(([k, v]) => <Fact key={k} name={k} value={v} />)}
        </div>
      )}
      {m.activities?.length > 0 && (
        <Section title="Latest activity">
          <ul className="space-y-1.5">
            {m.activities.map((a, i) => (
              <li key={i} className="rounded-md px-1.5 text-[13px]">
                <span className="font-medium text-gray-900">{label(a.type)}</span>
                <span className="text-muted-foreground"> · {when(a.at)}{a.by ? ` · ${a.by}` : ''}</span>
                <p className="line-clamp-2 text-xs text-gray-600">{a.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

function MatchCard({ m }) {
  const t = TYPE[m.type] ?? TYPE.client
  const Icon = t.icon
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-3">
      <div className="flex items-start gap-2.5">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', t.tone)}><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-gray-900">{m.title}</p>
            {m.type === 'client' && m.priority === 'VIP' && <Badge variant="warning">VIP</Badge>}
            {m.type === 'client' && m.priority === 'HIGH' && <Badge variant="orange">High priority</Badge>}
            {m.type === 'lead' && <Badge status={m.status}>{label(m.status)}</Badge>}
            {m.type === 'lead' && ['HIGH', 'URGENT'].includes(m.priority) && <Badge variant="orange">{label(m.priority)}</Badge>}
            {m.type === 'client' && !m.isActive && <Badge variant="default">Inactive</Badge>}
            {m.envoCustomer && <Badge variant="teal">Envo customer</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[t.name, m.code, m.subtitle].filter(Boolean).join(' · ')}
          </p>
          {(m.via || m.email || m.city) && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {[m.via && `Matched: ${m.via}`, m.email, m.city].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {m.type === 'client' && <ClientBody m={m} />}
      {m.type === 'lead' && <LeadBody m={m} />}

      {m.notes && (
        <p className="mt-3 flex gap-1.5 rounded-lg bg-amber-50/60 px-2.5 py-2 text-xs text-gray-700">
          <StickyNote className="mt-px size-3.5 shrink-0 text-amber-600" />
          <span className="line-clamp-3 whitespace-pre-line">{m.notes}</span>
        </p>
      )}

      {m.href && (
        <Link href={m.href}
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-gray-900 underline-offset-4 hover:underline">
          Open {t.name.toLowerCase()} <ExternalLink className="size-3.5" />
        </Link>
      )}
    </div>
  )
}

function OtherMatch({ m }) {
  const t = TYPE[m.type] ?? TYPE.client
  const Icon = t.icon
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 text-gray-400" />
      <span className="min-w-0 flex-1 truncate"><span className="font-medium text-gray-900">{m.title}</span>
        <span className="text-muted-foreground"> · {t.name}{m.via ? ` · ${m.via}` : ''}</span></span>
      {m.href && <ExternalLink className="size-3.5 shrink-0 text-gray-300" />}
    </>
  )
  return m.href
    ? <Link href={m.href} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-gray-50">{body}</Link>
    : <div className="flex items-center gap-2 px-1.5 py-1 text-[13px]">{body}</div>
}

function RecentCalls({ number }) {
  const { calls, error } = useCallHistory(number)
  if (error) return <Section title="Recent calls"><p className="px-1.5 text-xs text-muted-foreground">{error}</p></Section>
  if (!calls) return null
  if (!calls.length) return <Section title="Recent calls"><p className="px-1.5 text-xs text-muted-foreground">No earlier calls with this number in Envo.</p></Section>
  return (
    <Section title="Recent calls">
      <ul>
        {calls.map(c => {
          const Icon = !c.answered ? PhoneMissed : c.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming
          return (
            <li key={c.id} className="flex items-center gap-2 px-1.5 py-1 text-[13px]">
              <Icon className={cn('size-3.5 shrink-0', c.answered ? 'text-gray-400' : 'text-red-500')} />
              <span className="text-gray-900">{c.direction === 'outbound' ? 'Outgoing' : c.direction === 'internal' ? 'Internal' : 'Incoming'}</span>
              <span className="text-muted-foreground">{c.answered ? mmss(c.talkSec) : 'missed'}{c.mine ? ' · you' : ''}</span>
              <span className="ml-auto text-xs text-muted-foreground">{when(c.startedAt)}</span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/**
 * The panel under a call. `lookup` is useCallerLookup(number) from the call view, so
 * the call's name and these details come from one request. onAddLead(number) opens the
 * lead form (kept outside the panel, which may be minimised while it is open).
 */
export default function CallerDetails({ number, lookup, onAddLead }) {
  const { can } = usePermission()
  const { matches, loading, error } = lookup
  const isPhoneNumber = (number ?? '').replace(/\D/g, '').length >= 7

  return (
    <div className="border-t border-gray-100 bg-gray-50/50 px-3 pb-3 pt-2.5">
      {loading && !matches?.length ? (
        <div className="flex items-center gap-2 px-1 py-3 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Looking up {formatNumber(number)}…</div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}
        </div>
      ) : matches?.length ? (
        <>
          <MatchCard m={matches[0]} />
          {matches.length > 1 && (
            <Section title="Also matches">
              {matches.slice(1).map(m => <OtherMatch key={`${m.type}:${m.id}`} m={m} />)}
            </Section>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-3 text-center">
          <p className="text-sm font-medium text-gray-900">Not in the CRM</p>
          <p className="mt-0.5 text-xs text-muted-foreground">No client, lead or colleague has {formatNumber(number)}.</p>
          {isPhoneNumber && can('sales.leads.create') && (
            <button type="button" onClick={() => onAddLead?.(number)}
              className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-white px-3 text-[13px] font-medium text-gray-900 shadow-xs hover:bg-accent">
              <UserPlus className="size-4" /> Add as lead
            </button>
          )}
        </div>
      )}

      {isPhoneNumber && <RecentCalls number={number} />}
    </div>
  )
}
