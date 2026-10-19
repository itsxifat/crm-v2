'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { Plus, X, Printer, Receipt, FileText } from 'lucide-react'
import FileUpload from '@/components/ui/FileUpload'
import Badge from '@/components/ui/Badge'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import PageHeader from '@/components/ui/PageHeader'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/Input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { CURRENCIES } from '@/lib/currencies'
import { useConfig, subcategoriesFor } from '@/lib/useConfig'
import { dhakaDayKey } from '@/lib/dhakaTime'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmt     = (n, c = 'BDT') => `${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })} ${c}`

const STATUS_BADGE = {
  PENDING:    'warning',
  PAID:       'primary',
  AUTHORIZED: 'success',
  REJECTED:   'danger',
}
const STATUS_LABEL = {
  PENDING:    'Pending review',
  PAID:       'Paid — awaiting authorization',
  AUTHORIZED: 'Reimbursed',
  REJECTED:   'Rejected',
}

// ─── Submit Expense Modal ─────────────────────────────────────────────────────

function ExpenseModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    title: '', amount: '', currency: 'BDT',
    date: dhakaDayKey(),
    projectId: '', category: '', subcategory: '', invoiceUrl: '', notes: '',
  })
  const [projects, setProjects] = useState([])
  const [saving,   setSaving]   = useState(false)
  const { expenseCategories } = useConfig()

  useEffect(() => {
    fetch('/api/projects?limit=100').then(r => r.json()).then(j => setProjects(j.data ?? [])).catch(() => {})
  }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Subcategories belong to the chosen category; changing category resets it.
  const subcats  = subcategoriesFor(expenseCategories, form.category)
  const hasProof = !!form.invoiceUrl
  const detailOk = hasProof || form.notes.trim().length >= 30

  async function save() {
    if (!form.title.trim())        { toast.error('Enter a reason / title'); return }
    if (!(Number(form.amount) > 0)) { toast.error('Enter a valid amount'); return }
    if (!form.category)            { toast.error('Select a category'); return }
    if (subcats.length > 0 && !form.subcategory) { toast.error('Select a subcategory'); return }
    if (!detailOk)                 { toast.error('Attach a proof, or describe the expense in detail (30+ characters)'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:      form.title.trim(),
          amount:     Number(form.amount),
          currency:   form.currency,
          date:       form.date,
          projectId:  form.projectId || undefined,
          category:   form.category,
          subcategory: form.subcategory || undefined,
          invoiceUrl: form.invoiceUrl || undefined,
          notes:      form.notes.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Expense submitted for approval')
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-5">
          <h3 className="text-base font-semibold tracking-tight text-gray-900">Submit expense</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-0.5 text-gray-400">
            <X />
          </Button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto px-6 pb-5 pt-1 sm:grid-cols-2">
          <Field label="Reason / title" required className="sm:col-span-2">
            <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Taxi to client meeting" />
          </Field>
          <Field label="Amount" required>
            <Input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Currency">
            <NativeSelect value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="Project">
            <NativeSelect value={form.projectId} onChange={e => set('projectId', e.target.value)}>
              <option value="">None</option>
              {projects.map(p => <option key={p.id ?? p._id} value={p.id ?? p._id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field
            label="Category"
            required
            error={expenseCategories.length === 0 ? 'No expense categories set up in Config → Finance.' : undefined}
          >
            <NativeSelect value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
              disabled={expenseCategories.length === 0}>
              <option value="">Select…</option>
              {expenseCategories.map(c => <option key={c.id ?? c.label} value={c.label}>{c.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Subcategory" required={subcats.length > 0}>
            <NativeSelect value={form.subcategory} onChange={e => set('subcategory', e.target.value)}
              disabled={!form.category || subcats.length === 0}>
              <option value="">
                {!form.category ? 'Select a category first' : subcats.length === 0 ? 'None' : 'Select…'}
              </option>
              {subcats.map(s => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-2">
            <FileUpload
              label="Proof / memo / invoice"
              value={form.invoiceUrl}
              onUploaded={url => set('invoiceUrl', url)}
            />
          </div>
          <Field label="Description" required={!hasProof} className="sm:col-span-2">
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              placeholder="What was it for?"
              className="resize-none" />
            {!hasProof && (
              <p className={`mt-1.5 text-xs ${detailOk ? 'text-muted-foreground' : 'text-amber-700'}`}>
                No proof attached — describe it in detail ({form.notes.trim().length}/30 characters).
              </p>
            )}
          </Field>
        </div>

        <div className="flex shrink-0 justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Submit</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MyExpensesPage() {
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [addModal, setAddModal] = useState(false)
  const [page,     setPage]     = useState(1)
  const [pages,    setPages]    = useState(1)
  const [total,    setTotal]    = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Only the user's own reimbursement submissions — not company expenses they logged.
      const res  = await fetch(`/api/expenses?mine=true&origin=REIMBURSEMENT&limit=50&page=${page}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRows(json.data ?? [])
      setPages(Math.max(1, json.meta?.pages ?? 1))
      setTotal(json.meta?.total ?? (json.data ?? []).length)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load your expenses')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <PageHeader
        title="My expenses"
        actions={<Button onClick={() => setAddModal(true)}><Plus /> New expense</Button>}
      />

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingSpinner className="py-16" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expenses yet"
            action={<Button variant="outline" size="sm" onClick={() => setAddModal(true)}><Plus /> New expense</Button>}
          />
        ) : (
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Expense ID</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id ?? r._id}>
                  <TableCell className="whitespace-nowrap text-xs font-medium text-muted-foreground">{r.expenseId ?? '—'}</TableCell>
                  <TableCell>
                    <p className="max-w-[260px] truncate text-sm font-medium text-gray-900">{r.title}</p>
                    {r.category && <p className="mt-0.5 text-xs text-muted-foreground">{r.category}{r.subcategory ? ` / ${r.subcategory}` : ''}</p>}
                    {r.projectId?.name && <p className="mt-0.5 text-xs text-muted-foreground">{r.projectId.name}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">{fmt(r.amount, r.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[r.status] ?? 'default'}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground">{fmtDate(r.date ?? r.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {r.status !== 'PENDING' && r.status !== 'REJECTED' && (
                        <a href={`/api/expenses/${r.id ?? r._id}/voucher`} target="_blank" rel="noreferrer"
                          className={buttonVariants({ variant: 'outline', size: 'xs' })}>
                          <Printer /> Invoice
                        </a>
                      )}
                      {r.status === 'AUTHORIZED' && r.signedInvoiceUrl && (
                        <a href={r.signedInvoiceUrl} target="_blank" rel="noreferrer"
                          className={buttonVariants({ variant: 'outline', size: 'xs' })}>
                          <FileText className="size-3.5 text-emerald-600" /> Authorized
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-muted-foreground">Page {page} of {pages} · {total} submissions</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="xs" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
                Previous
              </Button>
              <Button variant="outline" size="xs" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages || loading}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {addModal && <ExpenseModal onClose={() => setAddModal(false)} onSaved={() => (page === 1 ? load() : setPage(1))} />}
    </div>
  )
}
