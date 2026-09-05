'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, Loader2, ArrowLeft, Layers, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import ClientSearch from '@/components/ui/ClientSearch'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

const ic = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lc = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5'

const TERMS_TEMPLATES = [
  'Payment due within 7 days of invoice date.',
  'Payment due within 15 days of invoice date.',
  'Payment due within 30 days of invoice date.',
  'Advance payment required before work begins.',
  '50% advance, 50% on delivery.',
]

export default function InvoiceForm({ invoice, defaultProjectId, defaultClientId }) {
  const router = useRouter()
  const isEdit = !!invoice

  const [clientId,  setClientId]  = useState(invoice?.clientId?.id ?? invoice?.clientId ?? defaultClientId ?? '')
  const [projectId, setProjectId] = useState(
    invoice?.projectId?.id ?? invoice?.projectId ?? defaultProjectId ?? ''
  )
  const [projects,  setProjects]  = useState([])
  const [items,     setItems]     = useState(invoice?.items ?? [{ description: '', quantity: 1, rate: 0, amount: 0 }])
  const [issueDate, setIssueDate] = useState(invoice?.issueDate?.slice(0,10) ?? new Date().toISOString().slice(0,10))
  const [dueDate,   setDueDate]   = useState(invoice?.dueDate?.slice(0,10) ?? '')
  const [taxRate,   setTaxRate]   = useState(invoice?.taxRate ?? 0)
  const [discount,  setDiscount]  = useState(invoice?.discount ?? 0)
  const [notes,     setNotes]     = useState(invoice?.notes ?? '')
  const [terms,     setTerms]     = useState(invoice?.terms ?? '')
  const [saving,       setSaving]       = useState(false)
  // Invoices already raised against the selected project — context, not a block:
  // a project may carry as many invoices as the billing plan needs.
  const [siblings,     setSiblings]     = useState(null)
  const [siblingsLoading, setSiblingsLoading] = useState(false)

  // Load projects for client
  useEffect(() => {
    if (!clientId) { setProjects([]); return }
    fetch(`/api/projects?clientId=${clientId}&limit=200`)
      .then(r => r.json())
      .then(j => setProjects(j.data ?? []))
      .catch(() => {})
  }, [clientId])

  // Load the project's existing invoices so the user can see what has already
  // been billed before adding another one.
  useEffect(() => {
    if (!projectId) { setSiblings(null); return }
    setSiblingsLoading(true)
    fetch(`/api/invoices?projectId=${projectId}&limit=100&sort=issueDate&dir=asc`)
      .then(r => r.json())
      .then(j => setSiblings(j.data ?? []))
      .catch(() => setSiblings([]))
      .finally(() => setSiblingsLoading(false))
  }, [projectId])

  // Everything already billed against this project (excludes the invoice being
  // edited and any cancelled ones).
  const alreadyBilled = (siblings ?? [])
    .filter(i => i.status !== 'CANCELLED' && i.id !== invoice?.id)
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0)

  const selectedProject = projects.find(x => (x.id ?? x._id) === projectId) ?? null
  const projectNet      = selectedProject ? Math.max(0, Number(selectedProject.budget) || 0) : 0
  const remainingToBill = Math.max(0, projectNet - alreadyBilled)

  // Auto-fill the first line when a project is picked (new invoices only), using
  // the amount NOT yet billed rather than the whole contract — that's the number
  // you want on invoice #2 onward.
  useEffect(() => {
    if (isEdit || !projectId || projects.length === 0 || siblings === null) return
    const p = projects.find(x => (x.id ?? x._id) === projectId)
    if (!p) return
    const net  = Math.max(0, Number(p.budget) || 0)
    const done = (siblings ?? []).filter(i => i.status !== 'CANCELLED')
    const rate = Math.max(0, net - done.reduce((sum, i) => sum + (Number(i.total) || 0), 0))
    const seq  = done.length + 1
    setItems([{
      description: done.length > 0
        ? `[${p.projectCode ?? p.name}] ${p.name} — Invoice ${seq}`
        : `[${p.projectCode ?? p.name}] ${p.name}`,
      quantity: 1, rate, amount: rate,
    }])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projects, siblings])

  const clientProjects = clientId
    ? projects.filter(p => {
        const cid = p.clientId?.id ?? p.clientId?._id ?? p.clientId
        return String(cid) === String(clientId)
      })
    : []

  function updateItem(idx, field, val) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: val }
      if (field === 'quantity' || field === 'rate')
        updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0)
      return updated
    }))
  }

  function addItem() {
    setItems(prev => [...prev, { description: '', quantity: 1, rate: 0, amount: 0 }])
  }

  function removeItem(idx) {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== idx)
      return next.length > 0 ? next : [{ description: '', quantity: 1, rate: 0, amount: 0 }]
    })
  }

  const subtotal  = items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const taxAmount = subtotal * ((Number(taxRate) || 0) / 100)
  const total     = subtotal + taxAmount - (Number(discount) || 0)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!clientId) { toast.error('Please select a client'); return }
    if (items.length === 0 || items.every(i => !i.description.trim())) {
      toast.error('Add at least one item'); return
    }
    setSaving(true)
    try {
      const body = {
        clientId,
        projectId: projectId || null,
        items, issueDate, dueDate: dueDate || null,
        taxRate: Number(taxRate) || 0, discount: Number(discount) || 0,
        notes: notes || null, terms: terms || null, currency: 'BDT',
      }
      const url    = isEdit ? `/api/invoices/${invoice.id}` : '/api/invoices'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()

      if (!res.ok) throw new Error(json.error ?? 'Failed')
      if (json.combined) {
        toast.success(`Invoice created — rolled into combined invoice ${json.combined.combinedNumber}`)
      } else {
        toast.success(isEdit ? 'Invoice updated' : 'Invoice created')
      }
      router.push(`/admin/invoices/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Invoice' : 'New Invoice'}</h1>
          <p className="text-sm text-gray-500">
            {isEdit ? `Editing ${invoice.invoiceNumber}` : 'Bill a project in as many invoices as you need — they roll up into a combined invoice'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client + Project */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Client & Project</h2>

          <div>
            <label className={lc}>Client *</label>
            <ClientSearch
              value={clientId}
              onChange={id => { setClientId(id); setProjectId(''); setItems([{ description: '', quantity: 1, rate: 0, amount: 0 }]) }}
            />
          </div>

          {clientId && (
            <div>
              <label className={lc}>Project</label>
              {clientProjects.length === 0 ? (
                <p className="text-xs text-gray-400">No projects found for this client.</p>
              ) : (
                <Select value={projectId}
                  onChange={v => setProjectId(v ?? '')}
                  options={clientProjects.map(p => ({
                    value: p.id ?? p._id,
                    label: `${p.projectCode} — ${p.name}${p.budget > 0 ? ` (৳${(p.budget || 0).toLocaleString()})` : ''}`,
                  }))}
                  placeholder="— No project (standalone invoice) —"
                  disabled={isEdit}
                />
              )}
              {projectId && siblingsLoading && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking existing invoices…
                </p>
              )}

              {/* What has already been billed on this project */}
              {projectId && !siblingsLoading && (siblings?.length ?? 0) > 0 && (
                <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-gray-400" />
                      {siblings.length} existing invoice{siblings.length === 1 ? '' : 's'} on this project
                    </p>
                    {siblings[0]?.combined && (
                      <Link href={`/admin/invoices/combined/${siblings[0].combined.id}`} target="_blank"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                        <Layers className="w-3 h-3" /> {siblings[0].combined.combinedNumber}
                      </Link>
                    )}
                  </div>
                  <ul className="space-y-1 mb-2.5">
                    {siblings.map(i => (
                      <li key={i.id} className="flex items-center justify-between gap-3 text-xs">
                        <Link href={`/admin/invoices/${i.id}`} target="_blank"
                          className="font-mono text-gray-600 hover:text-blue-600 truncate">
                          {i.invoiceNumber}
                          <span className="ml-2 text-gray-400 font-sans">{i.status.replace(/_/g, ' ')}</span>
                        </Link>
                        <span className="text-gray-700 tabular-nums shrink-0">
                          ৳ {(Number(i.total) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-gray-200 pt-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Already billed</span>
                      <span className="font-semibold text-gray-800 tabular-nums">
                        ৳ {alreadyBilled.toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    {projectNet > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Remaining to bill</span>
                        <span className={`font-semibold tabular-nums ${remainingToBill > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                          ৳ {remainingToBill.toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </div>
                  {!isEdit && (
                    <p className="text-xs text-gray-400 mt-2">
                      Adding a second invoice creates (or updates) this project&rsquo;s combined invoice automatically.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dates */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">Dates</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lc}>Issue Date *</label>
              <DatePicker value={issueDate || null} onChange={v => setIssueDate(v ?? '')} />
            </div>
            <div>
              <label className={lc}>Due Date</label>
              <DatePicker value={dueDate || null} onChange={v => setDueDate(v ?? '')} />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Line Items</h2>
              <p className="text-xs text-gray-400 mt-0.5">Add all billing milestones, phases, or dues as separate line items.</p>
            </div>
            <button type="button" onClick={addItem}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-12 gap-2 px-1">
              <div className="col-span-6 text-xs font-semibold text-gray-400 uppercase">Description</div>
              <div className="col-span-2 text-xs font-semibold text-gray-400 uppercase">Qty</div>
              <div className="col-span-2 text-xs font-semibold text-gray-400 uppercase">Rate (৳)</div>
              <div className="col-span-2 text-xs font-semibold text-gray-400 uppercase text-right">Amount</div>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center rounded-xl p-1">
                <div className="col-span-6">
                  <input value={item.description}
                    onChange={e => updateItem(idx, 'description', e.target.value)}
                    placeholder="e.g. Phase 1 — Design, Monthly retainer April…"
                    className={ic} required />
                </div>
                <div className="col-span-2">
                  <input type="number" min="0.01" step="0.01"
                    value={item.quantity}
                    onChange={e => updateItem(idx, 'quantity', e.target.value)}
                    className={ic} />
                </div>
                <div className="col-span-2">
                  <input type="number" min="0" step="0.01"
                    value={item.rate}
                    onChange={e => updateItem(idx, 'rate', e.target.value)}
                    className={ic} />
                </div>
                <div className="col-span-1 text-sm font-semibold text-gray-800 text-right">
                  {Number(item.amount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                </div>
                <div className="col-span-1 flex justify-end">
                  <button type="button" onClick={() => removeItem(idx)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="mt-6 border-t border-gray-100 pt-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-semibold text-gray-900">৳ {subtotal.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-gray-500">Tax (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={taxRate}
                onChange={e => setTaxRate(e.target.value)}
                className="w-28 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {taxAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Tax ({taxRate}%)</span>
                <span className="text-gray-700">৳ {taxAmount.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-gray-500">Discount (৳)</label>
              <input type="number" min="0" step="0.01" value={discount}
                onChange={e => setDiscount(e.target.value)}
                className="w-28 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-3">
              <span className="text-base font-bold text-gray-900">Total</span>
              <span className="text-xl font-bold text-blue-700">৳ {total.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
            </div>
            {invoice?.paidAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-green-600 font-medium">Paid so far</span>
                <span className="text-green-700 font-semibold">৳ {invoice.paidAmount.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes & Terms */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Notes & Terms</h2>
          <div>
            <label className={lc}>Notes (visible to client)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Thank you for your business…"
              className={`${ic} resize-none`} />
          </div>
          <div>
            <label className={lc}>Payment Terms</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {TERMS_TEMPLATES.map(t => (
                <button type="button" key={t} onClick={() => setTerms(t)}
                  className={`px-3 py-1 text-xs rounded-xl border transition-colors ${
                    terms === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}>
                  {t.split(' ').slice(0, 5).join(' ')}…
                </button>
              ))}
            </div>
            <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={2}
              placeholder="Payment terms…"
              className={`${ic} resize-none`} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2 shadow-sm">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Invoice'}
          </button>
        </div>
      </form>
    </div>
  )
}
