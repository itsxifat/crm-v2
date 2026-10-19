'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Plus, ClipboardCheck, Loader2, RefreshCw, CircleAlert, ScanBarcode, Printer } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import SearchInput from '@/components/ui/SearchInput'
import EmptyState from '@/components/ui/EmptyState'
import { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { AUDIT_STATUS_META } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const lc = 'block text-xs font-medium text-gray-600 mb-1'
const btnPrimary = 'inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50'

const STATUS_TABS = [
  { value: '',            label: 'All' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED',   label: 'Completed' },
  { value: 'CANCELLED',   label: 'Cancelled' },
]

function Progress({ summary }) {
  const total = summary?.total ?? 0
  const checked = total - (summary?.pending ?? 0)
  const pct = total ? Math.round((checked / total) * 100) : 0
  return (
    <div className="min-w-[120px]">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{checked}/{total}</span><span>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-gray-900 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ResultChips({ summary, unexpected }) {
  const chips = [
    { n: summary?.found, label: 'found', cls: 'bg-green-50 text-green-700' },
    { n: summary?.missing, label: 'missing', cls: 'bg-red-50 text-red-700' },
    { n: summary?.wrongLocation, label: 'misplaced', cls: 'bg-orange-50 text-orange-700' },
    { n: summary?.damaged, label: 'damaged', cls: 'bg-amber-50 text-amber-700' },
    { n: unexpected, label: 'unexpected', cls: 'bg-indigo-50 text-indigo-700' },
  ].filter(c => c.n > 0)
  if (!chips.length) return <span className="text-xs text-gray-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(c => <span key={c.label} className={cn('px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap', c.cls)}>{c.n} {c.label}</span>)}
    </div>
  )
}

// ─── New audit ────────────────────────────────────────────────────────────────

function NewAuditModal({ open, onClose, onCreated }) {
  const router = useRouter()
  const [options, setOptions] = useState({ locations: [], categories: [] })
  const [optLoading, setOptLoading] = useState(false)
  const [form, setForm] = useState({ name: '', locationId: '', categoryId: '', includeRepair: false, includeLost: false, notes: '' })
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clash, setClash] = useState(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setForm({ name: '', locationId: '', categoryId: '', includeRepair: false, includeLost: false, notes: '' })
    setClash(null)
    setOptLoading(true)
    fetch('/api/inventory/audits?options=1')
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!ok) throw new Error(j.error || 'Failed to load locations'); setOptions(j.data) })
      .catch(err => toast.error(err.message))
      .finally(() => setOptLoading(false))
  }, [open])

  // Live count of assets the audit will expect.
  useEffect(() => {
    if (!open) return
    const id = ++seq.current
    setPreviewing(true)
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ preview: '1' })
        if (form.locationId) p.set('locationId', form.locationId)
        if (form.categoryId) p.set('categoryId', form.categoryId)
        if (form.includeRepair) p.set('includeRepair', '1')
        if (form.includeLost) p.set('includeLost', '1')
        const res = await fetch(`/api/inventory/audits?${p}`)
        const json = await res.json()
        if (id !== seq.current) return
        setPreview(res.ok ? json.data : null)
      } catch {
        if (id === seq.current) setPreview(null)
      } finally {
        if (id === seq.current) setPreviewing(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [open, form.locationId, form.categoryId, form.includeRepair, form.includeLost])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(e) {
    e?.preventDefault()
    setSaving(true)
    setClash(null)
    try {
      const res = await fetch('/api/inventory/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim() || null,
          locationId: form.locationId || null,
          categoryId: form.categoryId || null,
          includeRepair: form.includeRepair,
          includeLost: form.includeLost,
          notes: form.notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (res.status === 409 && json.auditId) { setClash({ id: json.auditId, message: json.error }); return }
      if (!res.ok) throw new Error(json.error || 'Failed to start the audit')
      toast.success(`Audit ${json.data.auditNo ?? ''} started — ${json.data.expected} assets to count`)
      onCreated?.()
      router.push(`/admin/inventory/audits/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="md" title="Start a physical audit"
      description="Snapshot the assets expected in a place, then scan what you actually find.">
      <form id="new-audit-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={lc}>Location</label>
            <select value={form.locationId} onChange={set('locationId')} className={ic} disabled={optLoading}>
              <option value="">All locations</option>
              {options.locations.map(l => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Includes rooms and floors inside it.</p>
          </div>
          <div>
            <label className={lc}>Category</label>
            <select value={form.categoryId} onChange={set('categoryId')} className={ic} disabled={optLoading}>
              <option value="">All categories</option>
              {options.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.includeRepair} onChange={set('includeRepair')} className="mt-0.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
            <span>Include assets out for repair<span className="block text-xs text-gray-400">Usually off — they are with the repair vendor.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.includeLost} onChange={set('includeLost')} className="mt-0.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
            <span>Include assets already marked lost or stolen<span className="block text-xs text-gray-400">Turn on to look for them during this count.</span></span>
          </label>
        </div>
        <div>
          <label className={lc}>Name (optional)</label>
          <input value={form.name} onChange={set('name')} maxLength={120} className={ic} placeholder="Defaults to the location and month, e.g. Head Office — Oct 2026" />
        </div>
        <div>
          <label className={lc}>Notes (optional)</label>
          <textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} className={ic} placeholder="Who is counting, any areas to skip…" />
        </div>

        <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm', preview?.expected ? 'bg-gray-50 text-gray-700' : 'bg-amber-50 text-amber-800')}>
          {previewing ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : <ClipboardCheck className="w-4 h-4 shrink-0" />}
          {previewing ? 'Counting assets in scope…'
            : preview ? (preview.expected
              ? <span><strong>{preview.expected}</strong> asset{preview.expected === 1 ? '' : 's'} will be on the count sheet.</span>
              : 'No registered assets match this scope.')
              : 'Choose a scope to see how many assets will be counted.'}
        </div>

        {clash && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-sm text-red-700">
            <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{clash.message}. <Link href={`/admin/inventory/audits/${clash.id}`} className="font-medium underline">Open it</Link></p>
          </div>
        )}
      </form>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" form="new-audit-form" disabled={saving || previewing || !preview?.expected} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Start audit
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditsPage() {
  const router = useRouter()
  const { canAny } = usePermission()
  const canRun = canAny(['inventory.audit', 'inventory.manage'])
  const [rows, setRows]       = useState([])
  const [meta, setMeta]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [status, setStatus]   = useState('')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  const [newOpen, setNewOpen] = useState(false)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const id = ++loadSeq.current
    setLoading(true)
    setError('')
    try {
      const p = new URLSearchParams({ page: String(page), limit: '20' })
      if (status) p.set('status', status)
      if (search.trim()) p.set('search', search.trim())
      const res = await fetch(`/api/inventory/audits?${p}`)
      const json = await res.json()
      if (id !== loadSeq.current) return
      if (!res.ok) throw new Error(json.error || 'Failed to load audits')
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
    } catch (err) {
      if (id === loadSeq.current) setError(err.message || 'Failed to load audits')
    } finally {
      if (id === loadSeq.current) setLoading(false)
    }
  }, [page, status, search])

  useEffect(() => { load() }, [load])

  const counts = meta?.counts ?? {}
  const totalAll = Object.values(counts).reduce((s, n) => s + n, 0)

  const columns = [
    {
      key: 'auditNo', label: 'Audit',
      render: (r) => (
        <div className="min-w-[180px]">
          <p className="font-mono text-xs text-gray-500">{r.auditNo ?? '—'}</p>
          <p className="text-sm font-medium text-gray-900">{r.name}</p>
        </div>
      ),
    },
    {
      key: 'scope', label: 'Scope',
      render: (r) => (
        <div className="text-xs text-gray-600 min-w-[140px]">
          <p>{r.location?.name ?? 'All locations'}</p>
          <p className="text-gray-400">{r.category?.name ?? 'All categories'}</p>
        </div>
      ),
    },
    {
      key: 'status', label: 'Status',
      render: (r) => <InventoryBadge label={AUDIT_STATUS_META[r.status]?.label ?? r.status} color={AUDIT_STATUS_META[r.status]?.color ?? 'gray'} />,
    },
    { key: 'progress', label: 'Progress', render: (r) => <Progress summary={r.summary} /> },
    { key: 'results', label: 'Results', render: (r) => <ResultChips summary={r.summary} unexpected={r.unexpectedCount} /> },
    {
      key: 'startedAt', label: 'Started', sortable: true,
      render: (r) => (
        <div className="text-xs whitespace-nowrap">
          <p className="text-gray-700">{fmtDate(r.startedAt)}</p>
          {r.createdByName && <p className="text-gray-400">{r.createdByName}</p>}
        </div>
      ),
    },
    {
      key: 'completedAt', label: 'Closed',
      render: (r) => (
        <div className="text-xs whitespace-nowrap">
          <p className="text-gray-700">{fmtDate(r.completedAt)}</p>
          {r.completedByName && <p className="text-gray-400">{r.completedByName}</p>}
        </div>
      ),
    },
    {
      key: 'actions', label: '',
      render: (r) => (
        <div className="flex justify-end" onClick={e => e.stopPropagation()}>
          {r.status === 'IN_PROGRESS' ? (
            <Link href={`/admin/inventory/audits/${r.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
              <ScanBarcode className="w-3.5 h-3.5" /> Continue
            </Link>
          ) : (
            <a href={`/api/inventory/audits/${r.id}/print`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
              <Printer className="w-3.5 h-3.5" /> Report
            </a>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Physical Audit</h1>
          <p className="text-sm text-gray-500 mt-0.5">Count assets on the floor and reconcile them with the register</p>
        </div>
        {canRun && (
          <button type="button" onClick={() => setNewOpen(true)} className={btnPrimary}>
            <Plus className="w-4 h-4" /> New audit
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto max-w-full">
          {STATUS_TABS.map(t => {
            const n = t.value ? counts[t.value] ?? 0 : totalAll
            return (
              <button key={t.value || 'all'} type="button" onClick={() => { setStatus(t.value); setPage(1) }}
                className={cn('px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                  status === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {t.label}{meta ? <span className="ml-1 text-xs text-gray-400">{n}</span> : null}
              </button>
            )
          })}
        </div>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search audit no. or name" className="w-full sm:w-64" />
        <button type="button" onClick={load} disabled={loading} aria-label="Refresh"
          className="ml-auto p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {error ? (
          <EmptyState icon={CircleAlert} title="Couldn’t load audits" description={error}
            action={<button type="button" onClick={load} className={btnPrimary}><RefreshCw className="w-4 h-4" /> Try again</button>} />
        ) : !loading && rows.length === 0 && !status && !search ? (
          <EmptyState icon={ClipboardCheck} title="No audits yet"
            description="Start an audit for a location, then scan every tag you find. Missing and misplaced assets are listed for follow-up."
            action={canRun ? <button type="button" onClick={() => setNewOpen(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Start your first audit</button> : null} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} loading={loading}
              emptyTitle="No audits match" emptyDescription="Try another status or search."
              onRowClick={(r) => router.push(`/admin/inventory/audits/${r.id}`)} />
            {meta && meta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={meta} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      <NewAuditModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => setNewOpen(false)} />
    </div>
  )
}
