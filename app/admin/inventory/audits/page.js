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
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { AUDIT_STATUS_META } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

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
      <div className="mb-1 flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{checked}/{total}</span><span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-gray-900" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ResultChips({ summary, unexpected }) {
  const chips = [
    { n: summary?.found, label: 'found', variant: 'success' },
    { n: summary?.missing, label: 'missing', variant: 'danger' },
    { n: summary?.wrongLocation, label: 'misplaced', variant: 'orange' },
    { n: summary?.damaged, label: 'damaged', variant: 'warning' },
    { n: unexpected, label: 'unexpected', variant: 'indigo' },
  ].filter(c => c.n > 0)
  if (!chips.length) return <span className="text-xs text-gray-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(c => <Badge key={c.label} variant={c.variant}>{c.n} {c.label}</Badge>)}
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
      toast.success(`Audit ${json.data.auditNo ?? ''} started · ${json.data.expected} assets`)
      onCreated?.()
      router.push(`/admin/inventory/audits/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="md" title="New audit">
      <form id="new-audit-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Location">
            <NativeSelect value={form.locationId} onChange={set('locationId')} disabled={optLoading}
              title="Includes rooms and floors inside it">
              <option value="">All locations</option>
              {options.locations.map(l => <option key={l.id} value={l.id}>{l.path}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Category">
            <NativeSelect value={form.categoryId} onChange={set('categoryId')} disabled={optLoading}>
              <option value="">All categories</option>
              {options.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <div className="space-y-2.5">
          <label className="flex items-center gap-2 text-sm text-gray-700" title="Usually off — they are with the repair vendor">
            <input type="checkbox" checked={form.includeRepair} onChange={set('includeRepair')} className="rounded border-gray-300" />
            Include assets out for repair
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700" title="Turn on to look for them during this count">
            <input type="checkbox" checked={form.includeLost} onChange={set('includeLost')} className="rounded border-gray-300" />
            Include lost or stolen assets
          </label>
        </div>
        <Field label="Name">
          <Input value={form.name} onChange={set('name')} maxLength={120} placeholder="e.g. Head Office — Oct 2026" />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} placeholder="Optional" />
        </Field>

        <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm',
          preview?.expected ? 'border-gray-200/80 bg-gray-50 text-gray-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
          {previewing ? <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" /> : <ClipboardCheck className="size-4 shrink-0" />}
          {previewing ? 'Counting assets…'
            : preview ? (preview.expected
              ? <span><strong className="font-semibold">{preview.expected}</strong> asset{preview.expected === 1 ? '' : 's'} to count</span>
              : 'No assets match this scope')
              : 'Choose a scope to see the count'}
        </div>

        {clash && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <p>{clash.message}. <Link href={`/admin/inventory/audits/${clash.id}`} className="font-medium underline underline-offset-4">Open it</Link></p>
          </div>
        )}
      </form>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="new-audit-form" loading={saving} disabled={previewing || !preview?.expected}>
          Start audit
        </Button>
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
          <p className="font-medium text-gray-900">{r.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{r.auditNo ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'scope', label: 'Scope',
      render: (r) => (
        <div className="min-w-[140px] text-[13px]">
          <p className="text-gray-700">{r.location?.name ?? 'All locations'}</p>
          <p className="text-xs text-muted-foreground">{r.category?.name ?? 'All categories'}</p>
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
        <div className="whitespace-nowrap text-[13px]">
          <p className="text-gray-700">{fmtDate(r.startedAt)}</p>
          {r.createdByName && <p className="text-xs text-muted-foreground">{r.createdByName}</p>}
        </div>
      ),
    },
    {
      key: 'completedAt', label: 'Closed',
      render: (r) => (
        <div className="whitespace-nowrap text-[13px]">
          <p className="text-gray-700">{fmtDate(r.completedAt)}</p>
          {r.completedByName && <p className="text-xs text-muted-foreground">{r.completedByName}</p>}
        </div>
      ),
    },
    {
      key: 'actions', label: '',
      render: (r) => (
        <div className="flex justify-end" onClick={e => e.stopPropagation()}>
          {r.status === 'IN_PROGRESS' ? (
            <Button href={`/admin/inventory/audits/${r.id}`} variant="outline" size="xs">
              <ScanBarcode className="size-3.5" /> Continue
            </Button>
          ) : (
            <a href={`/api/inventory/audits/${r.id}/print`} target="_blank" rel="noreferrer"
              className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
              <Printer className="size-3.5" /> Report
            </a>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Physical audits"
        actions={canRun && (
          <Button onClick={() => setNewOpen(true)}>
            <Plus /> New audit
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={status}
          onChange={(v) => { setStatus(v); setPage(1) }}
          tabs={STATUS_TABS.map(t => ({ value: t.value, label: t.label, count: meta ? (t.value ? counts[t.value] ?? 0 : totalAll) : null }))}
        />
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search…" className="w-full sm:w-64" />
        <Button variant="ghost" size="icon-sm" onClick={load} disabled={loading} aria-label="Refresh" className="ml-auto text-gray-500">
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState icon={CircleAlert} title="Couldn’t load audits" description={error}
            action={<Button variant="outline" onClick={load}><RefreshCw /> Try again</Button>} />
        ) : !loading && rows.length === 0 && !status && !search ? (
          <EmptyState icon={ClipboardCheck} title="No audits yet"
            action={canRun ? <Button variant="outline" onClick={() => setNewOpen(true)}><Plus /> New audit</Button> : null} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} loading={loading}
              emptyTitle="No results"
              onRowClick={(r) => router.push(`/admin/inventory/audits/${r.id}`)} />
            {meta && meta.pages > 1 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <Pagination meta={meta} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </Card>

      <NewAuditModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => setNewOpen(false)} />
    </div>
  )
}
