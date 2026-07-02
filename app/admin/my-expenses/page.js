'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { Plus, X, Loader2, Printer, Receipt } from 'lucide-react'
import FileUpload from '@/components/ui/FileUpload'
import { CURRENCIES } from '@/lib/currencies'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmt     = (n, c = 'BDT') => `${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })} ${c}`

const STATUS_BADGE = {
  PENDING:    'bg-yellow-100 text-yellow-700',
  PAID:       'bg-blue-100 text-blue-700',
  AUTHORIZED: 'bg-green-100 text-green-700',
  REJECTED:   'bg-red-100 text-red-700',
}
const STATUS_LABEL = {
  PENDING:    'Pending review',
  PAID:       'Paid — awaiting authorization',
  AUTHORIZED: 'Reimbursed',
  REJECTED:   'Rejected',
}

const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

// ─── Submit Expense Modal ─────────────────────────────────────────────────────

function ExpenseModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    title: '', amount: '', currency: 'BDT',
    date: new Date().toISOString().slice(0, 10),
    projectId: '', invoiceUrl: '', notes: '',
  })
  const [projects, setProjects] = useState([])
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    fetch('/api/projects?limit=100').then(r => r.json()).then(j => setProjects(j.data ?? [])).catch(() => {})
  }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const hasProof = !!form.invoiceUrl
  const detailOk = hasProof || form.notes.trim().length >= 30

  async function save() {
    if (!form.title.trim())        { toast.error('Enter a reason / title'); return }
    if (!(Number(form.amount) > 0)) { toast.error('Enter a valid amount'); return }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Submit Expense</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Reason / Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Taxi to client meeting" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount *</label>
            <input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className={ic}>
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Related project</label>
            <select value={form.projectId} onChange={e => set('projectId', e.target.value)} className={ic}>
              <option value="">— None / general —</option>
              {projects.map(p => <option key={p.id ?? p._id} value={p.id ?? p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <FileUpload
              label="Proof / memo / invoice (optional)"
              value={form.invoiceUrl}
              onUploaded={url => set('invoiceUrl', url)}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Description {!hasProof && <span className="text-red-500">*</span>}
            </label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              placeholder="Describe what the expense was for. Required in detail if you have no proof to attach."
              className={`${ic} resize-none`} />
            {!hasProof && (
              <p className={`text-xs mt-1 ${detailOk ? 'text-gray-400' : 'text-amber-600'}`}>
                No proof attached — provide a detailed description ({form.notes.trim().length}/30 characters).
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Submit
          </button>
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Only the user's own reimbursement submissions — not company expenses they logged.
      const res  = await fetch('/api/expenses?mine=true&origin=REIMBURSEMENT&limit=50')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRows(json.data ?? [])
    } catch (err) {
      toast.error(err.message ?? 'Failed to load your expenses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">My Expenses</h1>
          <p className="text-sm text-gray-400 mt-0.5">Out-of-pocket expenses you’ve submitted for reimbursement</p>
        </div>
        <button onClick={() => setAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors">
          <Plus className="w-4 h-4" /> New Expense
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No expense submissions yet</p>
            <button onClick={() => setAddModal(true)} className="mt-3 text-sm text-blue-600 hover:underline">Submit your first expense</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Expense ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.id ?? r._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-gray-500 whitespace-nowrap">{r.expenseId ?? '—'}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900 max-w-[260px] truncate">{r.title}</p>
                      {r.projectId?.name && <p className="text-xs text-gray-400 mt-0.5">{r.projectId.name}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">{fmt(r.amount, r.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.date ?? r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        {r.status !== 'PENDING' && r.status !== 'REJECTED' && (
                          <a href={`/api/expenses/${r.id ?? r._id}/voucher`} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                            <Printer className="w-3.5 h-3.5" /> Voucher
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addModal && <ExpenseModal onClose={() => setAddModal(false)} onSaved={load} />}
    </div>
  )
}
