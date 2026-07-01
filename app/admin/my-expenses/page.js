'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Plus, Printer, Receipt } from 'lucide-react'
import FileUpload from '@/components/ui/FileUpload'
import { CURRENCIES } from '@/lib/currencies'

const STATUS_STYLES = {
  PENDING:  { dot: 'bg-yellow-400', label: 'Pending review' },
  APPROVED: { dot: 'bg-blue-500',   label: 'Approved — awaiting payment' },
  PAID:     { dot: 'bg-green-500',  label: 'Reimbursed' },
  REJECTED: { dot: 'bg-red-500',    label: 'Rejected' },
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] ?? { dot: 'bg-gray-400', label: status }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className="text-xs text-gray-600">{s.label}</span>
    </span>
  )
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const EMPTY = { title: '', amount: '', currency: 'BDT', date: new Date().toISOString().slice(0, 10), projectId: '', invoiceUrl: '', notes: '' }

export default function MyExpensesPage() {
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [projects, setProjects] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/expenses?mine=true&limit=50')
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
  useEffect(() => {
    fetch('/api/projects?limit=100')
      .then(r => r.json())
      .then(j => setProjects(j.data ?? []))
      .catch(() => {})
  }, [])

  const hasProof = !!form.invoiceUrl
  const detailOk = hasProof || form.notes.trim().length >= 30

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Enter a reason / title'); return }
    if (!(Number(form.amount) > 0)) { toast.error('Enter a valid amount'); return }
    if (!detailOk) { toast.error('Attach a proof, or describe the expense in detail (30+ characters)'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      setForm(EMPTY)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Receipt className="w-5 h-5 text-gray-700" />
        <h1 className="text-lg font-semibold text-gray-900">My Expenses</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-4">
        Submit money you spent out-of-pocket for the company. After an account manager approves it, a signed
        voucher is prepared and you’re reimbursed to your account or in cash.
      </p>

      {/* Submit form */}
      <form onSubmit={submit} className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-900">New reimbursement request</p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Title <span className="text-red-500">*</span></label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Taxi to client meeting, printer paper…" className={ic} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount <span className="text-red-500">*</span></label>
            <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="0.00" className={ic} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
            <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className={ic}>
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={ic} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Related project <span className="text-gray-400 text-xs">(optional)</span></label>
          <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} className={ic}>
            <option value="">— None / general —</option>
            {projects.map(p => <option key={p.id ?? p._id} value={p.id ?? p._id}>{p.name}</option>)}
          </select>
        </div>

        <FileUpload
          label="Proof / memo / invoice (optional)"
          value={form.invoiceUrl}
          onUploaded={url => setForm(f => ({ ...f, invoiceUrl: url }))}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description {!hasProof && <span className="text-red-500">*</span>}
          </label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
            placeholder="Describe what the expense was for. Required in detail if you have no proof to attach."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          {!hasProof && (
            <p className={`text-xs mt-1 ${detailOk ? 'text-gray-400' : 'text-amber-600'}`}>
              No proof attached — provide a detailed description ({form.notes.trim().length}/30 characters).
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Submit for approval
          </button>
        </div>
      </form>

      {/* My submissions */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">My submissions</p>
        </div>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No expense submissions yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Voucher</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.id ?? r._id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs font-medium text-gray-800 max-w-[200px] truncate">{r.title}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 whitespace-nowrap">
                      {(r.amount ?? 0).toLocaleString()} <span className="text-xs font-normal text-gray-400">{r.currency}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r.expenseInvoiceNo ?? '—'}</td>
                    <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.date ?? r.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {r.status !== 'PENDING' && r.status !== 'REJECTED' && (
                        <a href={`/api/expenses/${r.id ?? r._id}/voucher`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                          <Printer className="w-3.5 h-3.5" /> Voucher
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
