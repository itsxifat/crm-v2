'use client'

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, ScanBarcode, Check, X, MapPinOff, TriangleAlert, RotateCcw, Pencil, Printer, Loader2,
  CircleCheckBig, CircleAlert, CircleHelp, Plus, Trash2, Volume2, VolumeX, RefreshCw, Ban, ClipboardCheck,
  Search, ExternalLink, Info,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { InventoryBadge, AssetConditionBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { AUDIT_RESULT_META, AUDIT_STATUS_META, CONDITION_OPTIONS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'

const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : '—'
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dhaka' }) : ''
const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const lc = 'block text-xs font-medium text-gray-600 mb-1'
const btnPrimary = 'inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50'

const PAGE_SIZE = 150
const REFRESH_MS = 20000

const FILTERS = [
  { value: 'ALL',            label: 'All',           key: 'total' },
  { value: 'PENDING',        label: 'Not checked',   key: 'pending' },
  { value: 'FOUND',          label: 'Found',         key: 'found' },
  { value: 'MISSING',        label: 'Missing',       key: 'missing' },
  { value: 'WRONG_LOCATION', label: 'Misplaced',     key: 'wrongLocation' },
  { value: 'DAMAGED',        label: 'Damaged',       key: 'damaged' },
]

const MARK_BUTTONS = [
  { result: 'FOUND',          label: 'Found',     icon: Check,         cls: 'hover:bg-green-50 hover:text-green-700 hover:border-green-200' },
  { result: 'MISSING',        label: 'Missing',   icon: X,             cls: 'hover:bg-red-50 hover:text-red-700 hover:border-red-200' },
  { result: 'WRONG_LOCATION', label: 'Misplaced', icon: MapPinOff,     cls: 'hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200' },
  { result: 'DAMAGED',        label: 'Damaged',   icon: TriangleAlert, cls: 'hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200' },
]

const FEED_STYLE = {
  FOUND:              { icon: CircleCheckBig, cls: 'text-green-600 bg-green-50' },
  WRONG_LOCATION:     { icon: MapPinOff,      cls: 'text-orange-600 bg-orange-50' },
  DAMAGED:            { icon: TriangleAlert,  cls: 'text-amber-600 bg-amber-50' },
  ALREADY:            { icon: Info,           cls: 'text-gray-500 bg-gray-100' },
  OUT_OF_SCOPE:       { icon: CircleAlert,    cls: 'text-indigo-600 bg-indigo-50' },
  ALREADY_UNEXPECTED: { icon: Info,           cls: 'text-gray-500 bg-gray-100' },
  UNKNOWN:            { icon: CircleHelp,     cls: 'text-red-600 bg-red-50' },
  ERROR:              { icon: CircleAlert,    cls: 'text-red-600 bg-red-50' },
}

function storageGet(key) { try { return window.localStorage.getItem(key) } catch { return null } }
function storageSet(key, value) { try { window.localStorage.setItem(key, value) } catch { /* private mode */ } }

// ─── Line row ─────────────────────────────────────────────────────────────────

const LineRow = memo(function LineRow({ line, running, busy, onMark, onEdit }) {
  const meta = AUDIT_RESULT_META[line.result] ?? AUDIT_RESULT_META.PENDING
  const sub = [
    line.asset?.category?.name,
    line.asset?.serialNumber ? `S/N ${line.asset.serialNumber}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className={cn('flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4 px-4 py-3', busy && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">
          <span className="font-mono text-xs text-gray-500 mr-1.5">{line.assetTag}</span>
          <span className="font-medium">{line.assetName}</span>
        </p>
        <p className="text-xs text-gray-400 truncate">
          {[sub, line.expectedLocation?.name ? `Expected: ${line.expectedLocation.name}` : null, line.expectedEmployee?.name ? `With ${line.expectedEmployee.name}` : null]
            .filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 lg:w-72 lg:justify-end">
        <InventoryBadge label={meta.label} color={meta.color} />
        {line.condition && <AssetConditionBadge condition={line.condition} />}
        {line.result === 'WRONG_LOCATION' && line.foundLocation?.name && (
          <span className="text-xs text-orange-700">at {line.foundLocation.name}</span>
        )}
        {line.note && <span className="text-xs text-gray-500 italic truncate max-w-[180px]" title={line.note}>“{line.note}”</span>}
        {line.checkedAt && (
          <span className="text-[11px] text-gray-400 w-full lg:text-right">{line.checkedByName ? `${line.checkedByName} · ` : ''}{fmtTime(line.checkedAt)}</span>
        )}
      </div>
      {running && (
        <div className="flex items-center gap-1 shrink-0">
          {MARK_BUTTONS.map(b => {
            const Icon = b.icon
            const active = line.result === b.result
            return (
              <button key={b.result} type="button" disabled={busy || active} onClick={() => onMark(line, b.result)}
                title={b.label} aria-label={`Mark ${line.assetTag} ${b.label.toLowerCase()}`}
                className={cn('inline-flex items-center gap-1 border rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                  active ? 'bg-gray-900 text-white border-gray-900' : cn('border-gray-200 text-gray-600', b.cls))}>
                <Icon className="w-3.5 h-3.5" /><span className="hidden sm:inline">{b.label}</span>
              </button>
            )
          })}
          {line.result !== 'PENDING' && (
            <button type="button" disabled={busy} onClick={() => onMark(line, 'PENDING')} title="Reset to not checked"
              aria-label={`Reset ${line.assetTag}`} className="p-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => onEdit(line)} title="Condition, location or note"
            aria-label={`Edit ${line.assetTag}`} className="p-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {!running && line.result !== 'FOUND' && line.asset?.id && (
        <Link href={`/admin/inventory/assets/${line.asset.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 shrink-0">
          Open asset <ExternalLink className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
})

// ─── Modals ───────────────────────────────────────────────────────────────────

function EditLineModal({ line, locations, onClose, onSave }) {
  const [form, setForm] = useState({ result: 'FOUND', condition: '', locationId: '', note: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!line) return
    setForm({
      result: line.result === 'PENDING' ? 'FOUND' : line.result,
      condition: line.condition ?? '',
      // A found-at id whose location no longer exists (no name) is dropped, not re-sent.
      locationId: line.foundLocation?.name ? line.foundLocation.id : '',
      note: line.note ?? '',
    })
  }, [line])

  async function submit(e) {
    e?.preventDefault()
    setSaving(true)
    const ok = await onSave(line, form.result, {
      condition: form.condition || null,
      locationId: form.locationId || null,
      note: form.note.trim() || null,
    })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal open={!!line} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm" title="Record result"
      description={line ? `${line.assetTag} · ${line.assetName}` : undefined}>
      {line && (
        <form id="edit-line-form" onSubmit={submit} className="space-y-4">
          <div>
            <label className={lc}>Result</label>
            <div className="grid grid-cols-2 gap-2">
              {MARK_BUTTONS.map(b => {
                const Icon = b.icon
                return (
                  <button key={b.result} type="button" onClick={() => setForm(f => ({ ...f, result: b.result }))}
                    className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                      form.result === b.result ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50')}>
                    <Icon className="w-4 h-4" /> {b.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className={lc}>Condition</label>
            <select value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))} className={ic}>
              <option value="">Not recorded</option>
              {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lc}>Found at</label>
            <select value={form.locationId} onChange={e => setForm(f => ({ ...f, locationId: e.target.value }))} className={ic}>
              <option value="">Not recorded</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
            {line.expectedLocation?.name && <p className="text-[11px] text-gray-400 mt-1">Expected at {line.expectedLocation.name}</p>}
          </div>
          <div>
            <label className={lc}>Note</label>
            <textarea rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} maxLength={500} className={ic}
              placeholder="e.g. taken home by the assignee, label worn off" />
          </div>
        </form>
      )}
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" form="edit-line-form" disabled={saving} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </ModalFooter>
    </Modal>
  )
}

function CompleteModal({ open, summary, unexpectedCount, onClose, onConfirm }) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setNotes('') }, [open])
  const pending = summary?.pending ?? 0

  async function confirm() {
    setSaving(true)
    const ok = await onConfirm(notes.trim() || null)
    setSaving(false)
    if (ok) onClose()
  }

  const rows = [
    { label: 'Found', n: summary?.found ?? 0, cls: 'text-green-700' },
    { label: 'Missing', n: (summary?.missing ?? 0) + pending, cls: 'text-red-700' },
    { label: 'Misplaced', n: summary?.wrongLocation ?? 0, cls: 'text-orange-700' },
    { label: 'Damaged', n: summary?.damaged ?? 0, cls: 'text-amber-700' },
    { label: 'Unexpected', n: unexpectedCount, cls: 'text-indigo-700' },
  ]

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm" title="Complete this audit?"
      description="Results are written to every asset's history. Nothing is written off automatically.">
      <div className="space-y-4">
        {pending > 0 && (
          <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-800">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p><strong>{pending}</strong> asset{pending === 1 ? ' has' : 's have'} not been checked and will be recorded as <strong>missing</strong>.</p>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <dt className="text-xs text-gray-500">{r.label}</dt>
              <dd className={cn('text-sm font-semibold', r.cls)}>{r.n}</dd>
            </div>
          ))}
        </dl>
        <div>
          <label className={lc}>Closing notes (optional)</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} className={ic}
            placeholder="e.g. Room 3 was locked — recount next week" />
        </div>
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Keep counting</button>
        <button type="button" onClick={confirm} disabled={saving} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Complete audit
        </button>
      </ModalFooter>
    </Modal>
  )
}

function CancelModal({ open, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setReason('') }, [open])
  async function confirm() {
    setSaving(true)
    const ok = await onConfirm(reason.trim() || null)
    setSaving(false)
    if (ok) onClose()
  }
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm" title="Cancel this audit?"
      description="The counts are kept for reference but nothing is written to the assets.">
      <div>
        <label className={lc}>Reason (optional)</label>
        <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className={ic} placeholder="e.g. Started by mistake" />
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Keep it</button>
        <button type="button" onClick={confirm} disabled={saving}
          className="inline-flex items-center gap-2 bg-red-600 text-white hover:bg-red-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Cancel audit
        </button>
      </ModalFooter>
    </Modal>
  )
}

function RenameModal({ open, audit, onClose, onSave }) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open && audit) { setName(audit.name ?? ''); setNotes(audit.notes ?? '') } }, [open, audit])
  async function submit(e) {
    e?.preventDefault()
    if (!name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const ok = await onSave({ name: name.trim(), notes: notes.trim() || null })
    setSaving(false)
    if (ok) onClose()
  }
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm" title="Edit audit details">
      <form id="rename-audit-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className={lc}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120} className={ic} />
        </div>
        <div>
          <label className={lc}>Notes</label>
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} className={ic} />
        </div>
      </form>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" form="rename-audit-form" disabled={saving} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditSessionPage() {
  const { id } = useParams()
  const { canAny } = usePermission()
  const canRun = canAny(['inventory.audit', 'inventory.manage'])

  const [audit, setAudit]           = useState(null)
  const [lines, setLines]           = useState([])
  const [summary, setSummary]       = useState(null)
  const [unexpected, setUnexpected] = useState([])
  const [locations, setLocations]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')

  const [scanValue, setScanValue]   = useState('')
  const [countingAt, setCountingAt] = useState('')
  const [condition, setCondition]   = useState('')
  const [feed, setFeed]             = useState([])
  const [queued, setQueued]         = useState(0)
  const [soundOn, setSoundOn]       = useState(true)

  const [filter, setFilter]         = useState('ALL')
  const [search, setSearch]         = useState('')
  const [visible, setVisible]       = useState(PAGE_SIZE)
  const [busyIds, setBusyIds]       = useState(() => new Set())

  const [editLine, setEditLine]       = useState(null)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [cancelOpen, setCancelOpen]   = useState(false)
  const [renameOpen, setRenameOpen]   = useState(false)
  const [unexpForm, setUnexpForm]     = useState({ tag: '', description: '', note: '' })
  const [unexpSaving, setUnexpSaving] = useState(false)

  const inputRef  = useRef(null)
  const queueRef  = useRef([])
  const pumping   = useRef(false)
  const soundRef  = useRef(true)
  const audioRef  = useRef(null)
  const feedSeq   = useRef(0)
  const loadSeq   = useRef(0)

  const running = audit?.status === 'IN_PROGRESS' && canRun
  const locName = useCallback((lid) => locations.find(l => l.id === lid)?.path ?? null, [locations])

  // ── data ──
  const load = useCallback(async (quiet = false) => {
    const seq = ++loadSeq.current
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/inventory/audits/${id}`)
      const json = await res.json()
      if (seq !== loadSeq.current) return
      if (!res.ok) throw new Error(json.error || 'Failed to load the audit')
      const d = json.data
      setAudit(d)
      setLines(d.lines ?? [])
      setSummary(d.summary)
      setUnexpected(d.unexpected ?? [])
      setError('')
    } catch (err) {
      if (seq === loadSeq.current && !quiet) setError(err.message || 'Failed to load the audit')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const locKey = `audit:${id}:countingAt`
    const savedLoc = storageGet(locKey)
    if (savedLoc) setCountingAt(savedLoc)
    fetch('/api/inventory/audits?options=1')
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) return
        const list = j.data?.locations ?? []
        setLocations(list)
        // A saved location that was since deleted or deactivated is not in the list: the
        // select would show "Anywhere in scope" while every scan still sent the old id.
        if (savedLoc && !list.some(l => l.id === savedLoc)) {
          setCountingAt(cur => (cur === savedLoc ? '' : cur))
          if (storageGet(locKey) === savedLoc) storageSet(locKey, '')
        }
      })
      .catch(() => {})
    const savedSound = storageGet('audit:sound')
    if (savedSound === '0') { setSoundOn(false); soundRef.current = false }
  }, [id])

  // Keep other counters' work visible: quiet refresh while running and idle.
  useEffect(() => {
    if (audit?.status !== 'IN_PROGRESS') return
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible' || pumping.current || queueRef.current.length) return
      load(true)
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [audit?.status, load])

  // Focus the scan box once the session is ready.
  useEffect(() => { if (running) inputRef.current?.focus() }, [running])

  // A scanner typing while focus is elsewhere (e.g. after clicking a button) still lands in the scan box.
  useEffect(() => {
    if (!running) return
    function onKey(e) {
      // Space keeps activating focused buttons; only printable characters are redirected.
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return
      const t = e.target
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (document.querySelector('[role="dialog"]')) return
      const el = inputRef.current
      if (!el) return
      el.focus()
      const len = el.value.length
      try { el.setSelectionRange(len, len) } catch { /* not a text input */ }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running])

  // ── feedback ──
  function beep(kind) {
    if (!soundRef.current) return
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = audioRef.current ?? (audioRef.current = new Ctx())
      if (ctx.state === 'suspended') ctx.resume()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      const len = kind === 'error' ? 0.35 : 0.14
      o.type = kind === 'error' ? 'square' : 'sine'
      o.frequency.value = kind === 'ok' ? 880 : kind === 'warn' ? 560 : 200
      g.gain.setValueAtTime(0.06, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + len)
      o.connect(g)
      g.connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + len)
    } catch { /* audio unavailable */ }
    if (kind !== 'ok') { try { navigator.vibrate?.(kind === 'error' ? [80, 60, 80] : 60) } catch { /* no vibration */ } }
  }

  function pushFeed(entry) {
    const key = ++feedSeq.current
    setFeed(f => [{ key, at: new Date(), ...entry }, ...f].slice(0, 12))
  }

  function toggleSound() {
    const next = !soundRef.current
    soundRef.current = next
    setSoundOn(next)
    storageSet('audit:sound', next ? '1' : '0')
  }

  const applyLine = useCallback((patch) => {
    if (!patch?.assetId) return
    setLines(ls => ls.map(l => {
      if (l.assetId !== patch.assetId) return l
      const next = { ...l, ...patch }
      if (patch.foundLocation !== undefined) {
        next.foundLocation = patch.foundLocation
          ? { ...patch.foundLocation, name: patch.foundLocation.name ?? locName(patch.foundLocation.id) }
          : null
      }
      return next
    }))
  }, [locName])

  function forgetLocation(lid) {
    if (!lid) return
    setLocations(ls => ls.filter(l => l.id !== lid))
    setCountingAt(cur => (cur === lid ? '' : cur))
    const key = `audit:${id}:countingAt`
    if (storageGet(key) === lid) storageSet(key, '')
  }

  // ── scanning (sequential queue so fast scanners never drop a tag) ──
  async function processScan(job) {
    try {
      const res = await fetch(`/api/inventory/audits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', tag: job.value, locationId: job.locationId || null, condition: job.condition || null }),
      })
      const json = await res.json()
      if (res.status === 404 && json.code === 'UNKNOWN_TAG') {
        beep('error')
        pushFeed({ outcome: 'UNKNOWN', tag: json.tag ?? job.value, message: json.error })
        return
      }
      if (!res.ok) {
        beep('error')
        if (json.code === 'UNKNOWN_LOCATION') {
          // The counting location was deleted mid-count: drop it so the next scans go through.
          forgetLocation(job.locationId)
          pushFeed({ outcome: 'ERROR', tag: job.value, message: 'The counting location no longer exists — pick another one and scan this again' })
          return
        }
        pushFeed({ outcome: 'ERROR', tag: job.value, message: json.error || 'Scan failed' })
        if (res.status === 409) { toast.error(json.error || 'This audit is closed'); load(true) }
        return
      }
      const d = json.data
      if (d.line) applyLine(d.line)
      if (d.summary) setSummary(d.summary)
      if (d.unexpected) setUnexpected(d.unexpected)
      beep(d.outcome === 'FOUND' ? 'ok' : 'warn')
      pushFeed({ outcome: d.outcome, tag: d.tag ?? job.value, assetName: d.assetName, message: d.message })
    } catch {
      beep('error')
      pushFeed({ outcome: 'ERROR', tag: job.value, message: 'Network error — scan again' })
    }
  }

  async function pump() {
    if (pumping.current) return
    pumping.current = true
    try {
      while (queueRef.current.length) {
        const job = queueRef.current.shift()
        setQueued(queueRef.current.length)
        await processScan(job)
      }
    } finally {
      pumping.current = false
      setQueued(0)
    }
  }

  function submitScan(e) {
    e?.preventDefault()
    const value = scanValue.trim()
    if (!value) return
    queueRef.current.push({ value, locationId: countingAt, condition })
    setQueued(queueRef.current.length)
    setScanValue('')
    // Condition applies to one item only; the counting location stays until changed.
    if (condition) setCondition('')
    inputRef.current?.focus()
    pump()
  }

  function onScanKeyDown(e) {
    // Some scanners end with Tab instead of Enter.
    if ((e.key === 'Enter' || e.key === 'Tab') && scanValue.trim()) submitScan(e)
  }

  // ── actions ──
  const markLine = useCallback(async (line, result, extra = {}) => {
    setBusyIds(s => new Set(s).add(line.assetId))
    try {
      const res = await fetch(`/api/inventory/audits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark', assetId: line.assetId, result, ...extra }),
      })
      const json = await res.json()
      if (json.code === 'UNKNOWN_LOCATION') {
        setLocations(ls => ls.filter(l => l.id !== extra.locationId))
        throw new Error('That location no longer exists — pick another one')
      }
      if (!res.ok) throw new Error(json.error || 'Failed to update')
      applyLine(json.data.line)
      if (json.data.summary) setSummary(json.data.summary)
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    } finally {
      setBusyIds(s => { const n = new Set(s); n.delete(line.assetId); return n })
      if (!document.querySelector('[role="dialog"]')) inputRef.current?.focus()
    }
  }, [id, applyLine])

  const openEdit = useCallback((line) => setEditLine(line), [])

  async function addUnexpected(prefill) {
    const body = prefill ?? { tag: unexpForm.tag.trim() || null, description: unexpForm.description.trim() || null, note: unexpForm.note.trim() || null }
    if (!body.tag && !body.description) { toast.error('Enter the tag or a short description'); return }
    setUnexpSaving(true)
    try {
      const res = await fetch(`/api/inventory/audits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unexpected', ...body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to add')
      setUnexpected(json.data.unexpected ?? [])
      if (!prefill) setUnexpForm({ tag: '', description: '', note: '' })
      toast.success('Recorded as unexpected')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUnexpSaving(false)
      inputRef.current?.focus()
    }
  }

  async function removeUnexpected(item) {
    try {
      const res = await fetch(`/api/inventory/audits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_unexpected', index: item.index, tag: item.tag, description: item.description }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to remove')
      setUnexpected(json.data.unexpected ?? [])
    } catch (err) {
      toast.error(err.message)
      load(true)
    }
  }

  async function complete(notes) {
    try {
      const res = await fetch(`/api/inventory/audits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', notes }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to complete')
      const d = json.data
      setAudit(d); setLines(d.lines ?? []); setSummary(d.summary); setUnexpected(d.unexpected ?? [])
      setFilter('ALL')
      toast.success('Audit completed')
      for (const w of json.meta?.warnings ?? []) toast.error(w)
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }

  async function cancelAudit(reason) {
    try {
      const res = await fetch(`/api/inventory/audits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to cancel')
      const d = json.data
      setAudit(d); setLines(d.lines ?? []); setSummary(d.summary); setUnexpected(d.unexpected ?? [])
      toast.success('Audit cancelled')
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }

  async function saveDetails(patch) {
    try {
      const res = await fetch(`/api/inventory/audits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', ...patch }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to save')
      setAudit(a => ({ ...a, name: json.data.name, notes: json.data.notes }))
      toast.success('Saved')
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }

  // ── derived ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lines.filter(l => {
      if (filter !== 'ALL' && l.result !== filter) return false
      if (!q) return true
      return [l.assetTag, l.assetName, l.asset?.serialNumber, l.expectedEmployee?.name, l.expectedLocation?.name, l.asset?.category?.name]
        .some(v => v && String(v).toLowerCase().includes(q))
    })
  }, [lines, filter, search])

  useEffect(() => { setVisible(PAGE_SIZE) }, [filter, search])

  const s = summary ?? { total: 0, found: 0, missing: 0, wrongLocation: 0, damaged: 0, pending: 0 }
  const checked = s.total - s.pending
  const pct = s.total ? Math.round((checked / s.total) * 100) : 0
  const statusMeta = AUDIT_STATUS_META[audit?.status]
  const followUps = lines.filter(l => ['MISSING', 'WRONG_LOCATION', 'DAMAGED'].includes(l.result))

  // ── render ──
  if (loading && !audit) {
    return (
      <div className="flex justify-center py-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
    )
  }
  if (error && !audit) {
    return (
      <div className="space-y-6">
        <Link href="/admin/inventory/audits" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-4 h-4" /> Back to audits
        </Link>
        <div className="bg-white border border-gray-100 rounded-xl">
          <EmptyState icon={CircleAlert} title="Couldn’t open this audit" description={error}
            action={<button type="button" onClick={() => load()} className={btnPrimary}><RefreshCw className="w-4 h-4" /> Try again</button>} />
        </div>
      </div>
    )
  }
  if (!audit) return null

  return (
    <div className="space-y-5">
      <Link href="/admin/inventory/audits" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-4 h-4" /> Back to audits
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{audit.name}</h1>
            <InventoryBadge label={statusMeta?.label ?? audit.status} color={statusMeta?.color ?? 'gray'} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-mono text-xs mr-2">{audit.auditNo}</span>
            {audit.location?.name ?? 'All locations'} · {audit.category?.name ?? 'All categories'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Started {fmtDateTime(audit.startedAt)}{audit.createdBy?.name ? ` by ${audit.createdBy.name}` : ''}
            {audit.completedAt ? ` · ${audit.status === 'CANCELLED' ? 'Cancelled' : 'Completed'} ${fmtDateTime(audit.completedAt)}${audit.completedBy?.name ? ` by ${audit.completedBy.name}` : ''}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRun && (
            <button type="button" onClick={() => setRenameOpen(true)} className={btnGhost}>
              <Pencil className="w-4 h-4" /> <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          <a href={`/api/inventory/audits/${id}/print`} target="_blank" rel="noreferrer" className={btnGhost}>
            <Printer className="w-4 h-4" /> Report
          </a>
          {running && (
            <>
              <button type="button" onClick={() => setCancelOpen(true)} className={btnGhost}>
                <Ban className="w-4 h-4" /> Cancel
              </button>
              <button type="button" onClick={() => setCompleteOpen(true)} disabled={queued > 0} className={btnPrimary}>
                <ClipboardCheck className="w-4 h-4" /> Complete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <p className="text-2xl font-bold text-gray-900">{checked}<span className="text-base font-medium text-gray-400"> / {s.total}</span></p>
            <p className="text-xs text-gray-500">assets checked</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{pct}%</p>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden flex">
          {s.total > 0 && (
            <>
              <div className="h-full bg-green-500" style={{ width: `${(s.found / s.total) * 100}%` }} />
              <div className="h-full bg-orange-400" style={{ width: `${(s.wrongLocation / s.total) * 100}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${(s.damaged / s.total) * 100}%` }} />
              <div className="h-full bg-red-500" style={{ width: `${(s.missing / s.total) * 100}%` }} />
            </>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-7 gap-2">
          {[...FILTERS.slice(1), { value: 'UNEXPECTED', label: 'Unexpected', key: 'unexpected' }].map(f => {
            const n = f.key === 'unexpected' ? unexpected.length : s[f.key] ?? 0
            const color = f.value === 'UNEXPECTED' ? 'indigo' : AUDIT_RESULT_META[f.value]?.color
            const active = filter === f.value
            return (
              <button key={f.value} type="button"
                onClick={() => {
                  if (f.value === 'UNEXPECTED') { document.getElementById('unexpected-panel')?.scrollIntoView({ behavior: 'smooth' }); return }
                  setFilter(active ? 'ALL' : f.value)
                }}
                className={cn('rounded-lg border px-2 py-2 text-left transition-colors', active ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:bg-gray-50')}>
                <p className={cn('text-lg font-semibold', {
                  green: 'text-green-700', red: 'text-red-700', orange: 'text-orange-700', yellow: 'text-amber-700', indigo: 'text-indigo-700', gray: 'text-gray-700',
                }[color] ?? 'text-gray-700')}>{n}</p>
                <p className="text-[11px] text-gray-500 truncate">{f.label}</p>
              </button>
            )
          })}
          <div className="hidden sm:block rounded-lg border border-gray-100 px-2 py-2">
            <p className="text-lg font-semibold text-gray-700">{s.total}</p>
            <p className="text-[11px] text-gray-500">Expected</p>
          </div>
        </div>
      </div>

      {/* Scan */}
      {running && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 bg-white border border-gray-100 rounded-xl p-4 space-y-3">
            <form onSubmit={submitScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={inputRef}
                  value={scanValue}
                  onChange={e => setScanValue(e.target.value)}
                  onKeyDown={onScanKeyDown}
                  placeholder="Scan a label or type a tag, then Enter"
                  autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go"
                  aria-label="Asset tag or serial number"
                  className="w-full pl-11 pr-3 py-3 text-base font-mono border-2 border-gray-200 rounded-xl focus:outline-none focus:border-gray-900 focus:ring-0"
                />
              </div>
              <button type="submit" disabled={!scanValue.trim()} className={cn(btnPrimary, 'px-5')}>Check</button>
            </form>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lc}>Counting at</label>
                <select value={countingAt} onChange={e => { setCountingAt(e.target.value); storageSet(`audit:${id}:countingAt`, e.target.value) }} className={ic}>
                  <option value="">Anywhere in scope</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.path}</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Assets expected somewhere else are flagged as misplaced.</p>
              </div>
              <div>
                <label className={lc}>Condition of the next item</label>
                <select value={condition} onChange={e => setCondition(e.target.value)} className={ic}>
                  <option value="">Not recorded</option>
                  {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}{o.value === 'BROKEN' ? ' (records as damaged)' : ''}</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Resets after each scan.</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
              <p>USB and Bluetooth scanners work — keep this page open. QR labels, tags and maker serial numbers are recognised.</p>
              <button type="button" onClick={toggleSound} className="p-1.5 rounded-lg hover:bg-gray-50 text-gray-500 shrink-0"
                aria-label={soundOn ? 'Mute scan sounds' : 'Turn on scan sounds'} title={soundOn ? 'Mute scan sounds' : 'Turn on scan sounds'}>
                {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">Latest scans</p>
              {queued > 0 && <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> {queued} queued</span>}
            </div>
            {feed.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">Scan results appear here.</p>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto" aria-live="polite">
                {feed.map(f => {
                  const st = FEED_STYLE[f.outcome] ?? FEED_STYLE.ERROR
                  const Icon = st.icon
                  return (
                    <li key={f.key} className="flex items-start gap-2.5 px-4 py-2.5">
                      <span className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', st.cls)}><Icon className="w-4 h-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-900 truncate">
                          <span className="font-mono text-xs mr-1.5">{f.tag}</span>{f.assetName ?? ''}
                        </p>
                        <p className="text-xs text-gray-500">{f.message}</p>
                        {f.outcome === 'UNKNOWN' && (
                          <button type="button" disabled={unexpSaving}
                            onClick={() => addUnexpected({ tag: f.tag, description: null, note: null })}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900">
                            <Plus className="w-3 h-3" /> Record as unexpected item
                          </button>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-400 shrink-0">{fmtTime(f.at)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Completed: follow-up */}
      {audit.status === 'COMPLETED' && (
        <div className={cn('rounded-xl border p-4', followUps.length || unexpected.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200')}>
          {followUps.length || unexpected.length ? (
            <div className="flex gap-3">
              <TriangleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-semibold">{followUps.length} asset{followUps.length === 1 ? ' needs' : 's need'} follow-up{unexpected.length ? `, plus ${unexpected.length} unexpected item${unexpected.length === 1 ? '' : 's'}` : ''}</p>
                <p className="text-xs mt-0.5 text-amber-800">
                  Nothing is written off automatically. Open each asset to transfer it, send it for repair or mark it lost — a write-off needs approval.
                </p>
                <button type="button" onClick={() => setFilter('MISSING')} className="mt-2 text-xs font-medium underline">Show missing</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 text-sm text-green-800">
              <CircleCheckBig className="w-5 h-5 text-green-600 shrink-0" />
              <p className="font-medium">Everything on the list was found where expected.</p>
            </div>
          )}
        </div>
      )}
      {audit.notes && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <p className="text-xs font-medium text-gray-500 mb-1">Notes</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{audit.notes}</p>
        </div>
      )}

      {/* Lines */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
          <div className="flex gap-1 overflow-x-auto max-w-full">
            {FILTERS.map(f => (
              <button key={f.value} type="button" onClick={() => setFilter(f.value)}
                className={cn('px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                  filter === f.value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100')}>
                {f.label} <span className={filter === f.value ? 'text-gray-300' : 'text-gray-400'}>{s[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64 sm:ml-auto">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by tag, name, serial, person"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">
            {lines.length === 0 ? 'This audit has no expected assets.' : 'No assets match this filter.'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.slice(0, visible).map(l => (
              <LineRow key={l.assetId} line={l} running={running} busy={busyIds.has(l.assetId)} onMark={markLine} onEdit={openEdit} />
            ))}
          </div>
        )}
        {filtered.length > visible && (
          <div className="px-4 py-3 border-t border-gray-100 text-center">
            <button type="button" onClick={() => setVisible(v => v + PAGE_SIZE)} className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Show {Math.min(PAGE_SIZE, filtered.length - visible)} more of {filtered.length - visible}
            </button>
          </div>
        )}
      </div>

      {/* Unexpected */}
      <div id="unexpected-panel" className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-700">Unexpected items <span className="font-normal text-gray-400">({unexpected.length})</span></p>
          <p className="text-xs text-gray-400">Things on the floor that are not on the list — untagged equipment, unknown tags, assets from elsewhere.</p>
        </div>
        {running && (
          <form onSubmit={(e) => { e.preventDefault(); addUnexpected() }} className="grid grid-cols-1 sm:grid-cols-12 gap-2 px-4 py-3 border-b border-gray-50 bg-gray-50/50">
            <input value={unexpForm.tag} onChange={e => setUnexpForm(f => ({ ...f, tag: e.target.value }))} placeholder="Tag (if any)"
              maxLength={100} className={cn(ic, 'sm:col-span-3 font-mono')} />
            <input value={unexpForm.description} onChange={e => setUnexpForm(f => ({ ...f, description: e.target.value }))} placeholder="What is it? e.g. HP printer, no label"
              maxLength={500} className={cn(ic, 'sm:col-span-4')} />
            <input value={unexpForm.note} onChange={e => setUnexpForm(f => ({ ...f, note: e.target.value }))} placeholder="Note (optional)"
              maxLength={500} className={cn(ic, 'sm:col-span-3')} />
            <button type="submit" disabled={unexpSaving} className={cn(btnPrimary, 'sm:col-span-2')}>
              {unexpSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
            </button>
          </form>
        )}
        {unexpected.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">None recorded.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {unexpected.map(u => (
              <li key={`${u.index}-${u.tag ?? ''}-${u.description ?? ''}`} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">
                    {u.tag && <span className="font-mono text-xs text-gray-500 mr-1.5">{u.tag}</span>}
                    {u.description ?? '—'}
                  </p>
                  {u.note && <p className="text-xs text-gray-500">{u.note}</p>}
                </div>
                {running && (
                  <button type="button" onClick={() => removeUnexpected(u)} aria-label="Remove"
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <EditLineModal line={editLine} locations={locations} onClose={() => { setEditLine(null); inputRef.current?.focus() }}
        onSave={(line, result, extra) => markLine(line, result, extra)} />
      <CompleteModal open={completeOpen} summary={s} unexpectedCount={unexpected.length}
        onClose={() => setCompleteOpen(false)} onConfirm={complete} />
      <CancelModal open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={cancelAudit} />
      <RenameModal open={renameOpen} audit={audit} onClose={() => setRenameOpen(false)} onSave={saveDetails} />
    </div>
  )
}
