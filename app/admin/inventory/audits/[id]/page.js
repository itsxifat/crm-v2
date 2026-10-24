'use client'

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ScanBarcode, Check, X, MapPinOff, TriangleAlert, RotateCcw, Pencil, Printer, Loader2,
  CircleCheckBig, CircleAlert, CircleHelp, Plus, Trash2, Volume2, VolumeX, RefreshCw, Ban, ClipboardCheck,
  Search, ExternalLink, Info,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Label, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { InventoryBadge, AssetConditionBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { AUDIT_RESULT_META, AUDIT_STATUS_META, CONDITION_OPTIONS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import { codeIncludes } from '@/lib/searchMatch'

const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : '—'
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dhaka' }) : ''

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
  { result: 'FOUND',          label: 'Found',     icon: Check,         cls: 'hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200' },
  { result: 'MISSING',        label: 'Missing',   icon: X,             cls: 'hover:bg-red-50 hover:text-red-700 hover:border-red-200' },
  { result: 'WRONG_LOCATION', label: 'Misplaced', icon: MapPinOff,     cls: 'hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200' },
  { result: 'DAMAGED',        label: 'Damaged',   icon: TriangleAlert, cls: 'hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200' },
]

const FEED_STYLE = {
  FOUND:              { icon: CircleCheckBig, cls: 'text-emerald-600' },
  WRONG_LOCATION:     { icon: MapPinOff,      cls: 'text-orange-600' },
  DAMAGED:            { icon: TriangleAlert,  cls: 'text-amber-600' },
  ALREADY:            { icon: Info,           cls: 'text-gray-400' },
  OUT_OF_SCOPE:       { icon: CircleAlert,    cls: 'text-indigo-600' },
  ALREADY_UNEXPECTED: { icon: Info,           cls: 'text-gray-400' },
  UNKNOWN:            { icon: CircleHelp,     cls: 'text-red-600' },
  ERROR:              { icon: CircleAlert,    cls: 'text-red-600' },
}

const STAT_TONE = {
  green: 'text-emerald-700', red: 'text-red-700', orange: 'text-orange-700', yellow: 'text-amber-700', indigo: 'text-indigo-700', gray: 'text-gray-900',
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
    <div className={cn('flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-gray-50/70 lg:flex-row lg:items-center lg:gap-4', busy && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">
          <span className="mr-1.5 font-mono text-xs text-gray-500">{line.assetTag}</span>
          <span className="font-medium">{line.assetName}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
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
        {line.note && <span className="max-w-[180px] truncate text-xs italic text-muted-foreground" title={line.note}>“{line.note}”</span>}
        {line.checkedAt && (
          <span className="w-full text-[11px] text-gray-400 lg:text-right">{line.checkedByName ? `${line.checkedByName} · ` : ''}{fmtTime(line.checkedAt)}</span>
        )}
      </div>
      {running && (
        <div className="flex shrink-0 items-center gap-1">
          {MARK_BUTTONS.map(b => {
            const Icon = b.icon
            const active = line.result === b.result
            return (
              <button key={b.result} type="button" disabled={busy || active} onClick={() => onMark(line, b.result)}
                title={b.label} aria-label={`Mark ${line.assetTag} ${b.label.toLowerCase()}`}
                className={cn('inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium shadow-xs transition-colors',
                  active ? 'border-gray-900 bg-gray-900 text-white' : cn('border-gray-200 bg-white text-gray-600', b.cls))}>
                <Icon className="size-3.5" /><span className="hidden sm:inline">{b.label}</span>
              </button>
            )
          })}
          {line.result !== 'PENDING' && (
            <Button variant="outline" size="icon-xs" disabled={busy} onClick={() => onMark(line, 'PENDING')} title="Reset to not checked"
              aria-label={`Reset ${line.assetTag}`} className="text-gray-500">
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          <Button variant="outline" size="icon-xs" disabled={busy} onClick={() => onEdit(line)} title="Condition, location or note"
            aria-label={`Edit ${line.assetTag}`} className="text-gray-500">
            <Pencil className="size-3.5" />
          </Button>
        </div>
      )}
      {!running && line.result !== 'FOUND' && line.asset?.id && (
        <Link href={`/admin/inventory/assets/${line.asset.id}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
          Open asset <ExternalLink className="size-3" />
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
            <Label>Result</Label>
            <div className="grid grid-cols-2 gap-2">
              {MARK_BUTTONS.map(b => {
                const Icon = b.icon
                return (
                  <button key={b.result} type="button" onClick={() => setForm(f => ({ ...f, result: b.result }))}
                    className={cn('flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-xs transition-colors',
                      form.result === b.result ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')}>
                    <Icon className="size-4" /> {b.label}
                  </button>
                )
              })}
            </div>
          </div>
          <Field label="Condition">
            <NativeSelect value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
              <option value="">Not recorded</option>
              {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Found at" hint={line.expectedLocation?.name ? `Expected at ${line.expectedLocation.name}` : null}>
            <NativeSelect value={form.locationId} onChange={e => setForm(f => ({ ...f, locationId: e.target.value }))}>
              <option value="">Not recorded</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.path}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Note">
            <Textarea rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} maxLength={500}
              placeholder="e.g. Label worn off" />
          </Field>
        </form>
      )}
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="edit-line-form" loading={saving}>Save</Button>
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
    { label: 'Found', n: summary?.found ?? 0, cls: 'text-emerald-700' },
    { label: 'Missing', n: (summary?.missing ?? 0) + pending, cls: 'text-red-700' },
    { label: 'Misplaced', n: summary?.wrongLocation ?? 0, cls: 'text-orange-700' },
    { label: 'Damaged', n: summary?.damaged ?? 0, cls: 'text-amber-700' },
    { label: 'Unexpected', n: unexpectedCount, cls: 'text-indigo-700' },
  ]

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm" title="Complete this audit?"
      description="Results go to each asset's history. Nothing is written off automatically.">
      <div className="space-y-4">
        {pending > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p><strong className="font-semibold">{pending}</strong> unchecked asset{pending === 1 ? '' : 's'} will be recorded as <strong className="font-semibold">missing</strong>.</p>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd className={cn('text-sm font-semibold tabular-nums', r.cls)}>{r.n}</dd>
            </div>
          ))}
        </dl>
        <Field label="Closing notes">
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000}
            placeholder="Optional" />
        </Field>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Keep counting</Button>
        <Button onClick={confirm} loading={saving}>Complete audit</Button>
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
      description="Counts are kept; nothing is written to the assets.">
      <Field label="Reason">
        <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Optional" />
      </Field>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Keep it</Button>
        <Button variant="destructive" onClick={confirm} loading={saving}>Cancel audit</Button>
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
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm" title="Edit audit">
      <form id="rename-audit-form" onSubmit={submit} className="space-y-4">
        <Field label="Name" required>
          <Input value={name} onChange={e => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Notes">
          <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} />
        </Field>
      </form>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="rename-audit-form" loading={saving}>Save</Button>
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
          pushFeed({ outcome: 'ERROR', tag: job.value, message: 'Counting location no longer exists — pick another and scan again' })
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
    if (!body.tag && !body.description) { toast.error('Enter a tag or description'); return }
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
      // Asset tags match with separators ignored (EN-LAP-00042 = ENLAP00042).
      return codeIncludes(l.assetTag, q) ||
        [l.assetTag, l.assetName, l.asset?.serialNumber, l.expectedEmployee?.name, l.expectedLocation?.name, l.asset?.category?.name]
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
  if (loading && !audit) return <PageLoader />
  if (error && !audit) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit" back="/admin/inventory/audits" backLabel="Audits" />
        <Card>
          <EmptyState icon={CircleAlert} title="Couldn’t open this audit" description={error}
            action={<Button variant="outline" onClick={() => load()}><RefreshCw /> Try again</Button>} />
        </Card>
      </div>
    )
  }
  if (!audit) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={audit.name}
        back="/admin/inventory/audits"
        backLabel="Audits"
        meta={<InventoryBadge label={statusMeta?.label ?? audit.status} color={statusMeta?.color ?? 'gray'} />}
        actions={(
          <>
            {canRun && (
              <Button variant="outline" onClick={() => setRenameOpen(true)}>
                <Pencil /> <span className="hidden sm:inline">Edit</span>
              </Button>
            )}
            <a href={`/api/inventory/audits/${id}/print`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
              <Printer /> Report
            </a>
            {running && (
              <>
                <Button variant="outline" onClick={() => setCancelOpen(true)}>
                  <Ban /> Cancel
                </Button>
                <Button onClick={() => setCompleteOpen(true)} disabled={queued > 0}>
                  <ClipboardCheck /> Complete
                </Button>
              </>
            )}
          </>
        )}
      >
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="mr-2 font-mono text-xs">{audit.auditNo}</span>
          {audit.location?.name ?? 'All locations'} · {audit.category?.name ?? 'All categories'}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Started {fmtDateTime(audit.startedAt)}{audit.createdBy?.name ? ` by ${audit.createdBy.name}` : ''}
          {audit.completedAt ? ` · ${audit.status === 'CANCELLED' ? 'Cancelled' : 'Completed'} ${fmtDateTime(audit.completedAt)}${audit.completedBy?.name ? ` by ${audit.completedBy.name}` : ''}` : ''}
        </p>
      </PageHeader>

      {/* Progress */}
      <Card className="p-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{checked}<span className="text-base font-medium text-gray-400"> / {s.total}</span></p>
            <p className="text-xs text-muted-foreground">Checked</p>
          </div>
          <p className="text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{pct}%</p>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
          {s.total > 0 && (
            <>
              <div className="h-full bg-emerald-500" style={{ width: `${(s.found / s.total) * 100}%` }} />
              <div className="h-full bg-orange-400" style={{ width: `${(s.wrongLocation / s.total) * 100}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${(s.damaged / s.total) * 100}%` }} />
              <div className="h-full bg-red-500" style={{ width: `${(s.missing / s.total) * 100}%` }} />
            </>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
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
                className={cn('rounded-lg border px-3 py-2 text-left transition-colors', active ? 'border-gray-900 bg-gray-50' : 'border-gray-200/80 hover:bg-gray-50')}>
                <p className={cn('text-lg font-semibold tabular-nums', STAT_TONE[color] ?? 'text-gray-900')}>{n}</p>
                <p className="truncate text-xs text-muted-foreground">{f.label}</p>
              </button>
            )
          })}
          <div className="hidden rounded-lg border border-gray-200/80 px-3 py-2 sm:block">
            <p className="text-lg font-semibold tabular-nums text-gray-900">{s.total}</p>
            <p className="text-xs text-muted-foreground">Expected</p>
          </div>
        </div>
      </Card>

      {/* Scan */}
      {running && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card className="space-y-4 p-5 lg:col-span-3">
            <form onSubmit={submitScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-gray-400" />
                <input
                  ref={inputRef}
                  value={scanValue}
                  onChange={e => setScanValue(e.target.value)}
                  onKeyDown={onScanKeyDown}
                  placeholder="Scan or type a tag"
                  title="USB and Bluetooth scanners work. QR labels, tags and maker serial numbers are recognised."
                  autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go"
                  aria-label="Asset tag or serial number"
                  className="h-12 w-full rounded-lg border border-input bg-white pl-11 pr-3 font-mono text-base text-gray-900 shadow-xs outline-none transition-[color,box-shadow,border-color] placeholder:text-gray-400 focus:border-ring focus:ring-[3px] focus:ring-ring/30"
                />
              </div>
              <Button type="submit" size="lg" disabled={!scanValue.trim()} className="h-12">Check</Button>
            </form>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Counting at">
                <NativeSelect value={countingAt} onChange={e => { setCountingAt(e.target.value); storageSet(`audit:${id}:countingAt`, e.target.value) }}
                  title="Assets expected somewhere else are flagged as misplaced">
                  <option value="">Anywhere in scope</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.path}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Next item condition" hint="Resets after each scan">
                <NativeSelect value={condition} onChange={e => setCondition(e.target.value)}>
                  <option value="">Not recorded</option>
                  {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}{o.value === 'BROKEN' ? ' (records as damaged)' : ''}</option>)}
                </NativeSelect>
              </Field>
            </div>
          </Card>

          <Card className="flex flex-col overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
              <CardTitle>Latest scans</CardTitle>
              <div className="flex items-center gap-2">
                {queued > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {queued} queued</span>}
                <Button variant="ghost" size="icon-xs" onClick={toggleSound} className="text-gray-500"
                  aria-label={soundOn ? 'Mute scan sounds' : 'Turn on scan sounds'} title={soundOn ? 'Mute scan sounds' : 'Turn on scan sounds'}>
                  {soundOn ? <Volume2 /> : <VolumeX />}
                </Button>
              </div>
            </div>
            {feed.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">No scans yet</p>
            ) : (
              <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto" aria-live="polite">
                {feed.map(f => {
                  const st = FEED_STYLE[f.outcome] ?? FEED_STYLE.ERROR
                  const Icon = st.icon
                  return (
                    <li key={f.key} className="flex items-start gap-2.5 px-5 py-2.5">
                      <Icon className={cn('mt-0.5 size-4 shrink-0', st.cls)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-gray-900">
                          <span className="mr-1.5 font-mono text-xs">{f.tag}</span>{f.assetName ?? ''}
                        </p>
                        <p className="text-xs text-muted-foreground">{f.message}</p>
                        {f.outcome === 'UNKNOWN' && (
                          <button type="button" disabled={unexpSaving}
                            onClick={() => addUnexpected({ tag: f.tag, description: null, note: null })}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gray-900 underline-offset-4 hover:underline disabled:opacity-50">
                            <Plus className="size-3" /> Record as unexpected
                          </button>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{fmtTime(f.at)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Completed: follow-up */}
      {audit.status === 'COMPLETED' && (
        followUps.length || unexpected.length ? (
          <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{followUps.length} asset{followUps.length === 1 ? ' needs' : 's need'} follow-up{unexpected.length ? `, plus ${unexpected.length} unexpected item${unexpected.length === 1 ? '' : 's'}` : ''}</p>
              <p className="mt-0.5 text-xs">Nothing is written off automatically — open each asset to resolve it.</p>
              <button type="button" onClick={() => setFilter('MISSING')} className="mt-1.5 text-xs font-medium underline underline-offset-4">Show missing</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CircleCheckBig className="size-4 shrink-0" />
            <p className="font-medium">Everything was found where expected.</p>
          </div>
        )
      )}
      {audit.notes && (
        <Card className="px-5 py-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{audit.notes}</p>
        </Card>
      )}

      {/* Lines */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
          <Tabs
            size="sm"
            value={filter}
            onChange={setFilter}
            tabs={FILTERS.map(f => ({ value: f.value, label: f.label, count: s[f.key] ?? 0 }))}
          />
          <div className="relative w-full sm:ml-auto sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="h-8 pl-9" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon={lines.length === 0 ? ClipboardCheck : Search} className="py-10"
            title={lines.length === 0 ? 'No expected assets' : 'No results'} />
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.slice(0, visible).map(l => (
              <LineRow key={l.assetId} line={l} running={running} busy={busyIds.has(l.assetId)} onMark={markLine} onEdit={openEdit} />
            ))}
          </div>
        )}
        {filtered.length > visible && (
          <div className="flex justify-center border-t border-gray-100 px-4 py-3">
            <Button variant="ghost" size="sm" onClick={() => setVisible(v => v + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, filtered.length - visible)} more of {filtered.length - visible}
            </Button>
          </div>
        )}
      </Card>

      {/* Unexpected */}
      <Card id="unexpected-panel" className="overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <CardTitle title="Items found on the floor that are not on the list">
            Unexpected items <span className="font-normal text-muted-foreground">{unexpected.length}</span>
          </CardTitle>
        </div>
        {running && (
          <form onSubmit={(e) => { e.preventDefault(); addUnexpected() }} className="grid grid-cols-1 gap-2 border-b border-gray-100 bg-gray-50/60 px-5 py-3 sm:grid-cols-12">
            <Input value={unexpForm.tag} onChange={e => setUnexpForm(f => ({ ...f, tag: e.target.value }))} placeholder="Tag"
              maxLength={100} className="font-mono sm:col-span-3" />
            <Input value={unexpForm.description} onChange={e => setUnexpForm(f => ({ ...f, description: e.target.value }))} placeholder="What is it?"
              maxLength={500} className="sm:col-span-4" />
            <Input value={unexpForm.note} onChange={e => setUnexpForm(f => ({ ...f, note: e.target.value }))} placeholder="Note"
              maxLength={500} className="sm:col-span-3" />
            <Button type="submit" variant="outline" loading={unexpSaving} className="sm:col-span-2">
              {!unexpSaving && <Plus />} Add
            </Button>
          </form>
        )}
        {unexpected.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">None recorded</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {unexpected.map(u => (
              <li key={`${u.index}-${u.tag ?? ''}-${u.description ?? ''}`} className="flex items-start gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">
                    {u.tag && <span className="mr-1.5 font-mono text-xs text-gray-500">{u.tag}</span>}
                    {u.description ?? '—'}
                  </p>
                  {u.note && <p className="text-xs text-muted-foreground">{u.note}</p>}
                </div>
                {running && (
                  <Button variant="ghost" size="icon-sm" onClick={() => removeUnexpected(u)} aria-label="Remove"
                    className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EditLineModal line={editLine} locations={locations} onClose={() => { setEditLine(null); inputRef.current?.focus() }}
        onSave={(line, result, extra) => markLine(line, result, extra)} />
      <CompleteModal open={completeOpen} summary={s} unexpectedCount={unexpected.length}
        onClose={() => setCompleteOpen(false)} onConfirm={complete} />
      <CancelModal open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={cancelAudit} />
      <RenameModal open={renameOpen} audit={audit} onClose={() => setRenameOpen(false)} onSave={saveDetails} />
    </div>
  )
}
