'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Printer, RefreshCw, Layers, ExternalLink, Trash2,
  AlertTriangle, Loader2, Save,
} from 'lucide-react'
import TkAmt from '@/components/ui/TkAmt'
import CombinedInvoicePrintView, { openCombinedInvoicePrint } from '@/components/shared/CombinedInvoicePrintView'
import { usePermission } from '@/components/auth/Can'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_STYLES = {
  SENT:           { badge: 'bg-blue-100 text-blue-700',     label: 'Awaiting Payment' },
  PARTIALLY_PAID: { badge: 'bg-yellow-100 text-yellow-700', label: 'Partially Paid' },
  PAID:           { badge: 'bg-green-100 text-green-700',   label: 'Paid' },
  OVERDUE:        { badge: 'bg-red-100 text-red-600',       label: 'Overdue' },
  EMPTY:          { badge: 'bg-gray-100 text-gray-500',     label: 'No Issued Invoices' },
}

const CHILD_BADGE = {
  DRAFT:          'bg-gray-100 text-gray-600',
  SENT:           'bg-blue-100 text-blue-700',
  PARTIALLY_PAID: 'bg-yellow-100 text-yellow-700',
  PAID:           'bg-green-100 text-green-700',
  OVERDUE:        'bg-red-100 text-red-600',
  CANCELLED:      'bg-gray-100 text-gray-400',
}

export default function CombinedInvoiceDetailPage() {
  const { id }   = useParams()
  const router   = useRouter()
  const { can }  = usePermission()

  const [combined, setCombined] = useState(null)
  const [company,  setCompany]  = useState({})
  const [loading,  setLoading]  = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [printMode,  setPrintMode]  = useState(false)
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [savingText, setSavingText] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    try {
      const res  = await fetch(`/api/combined-invoices/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCombined(json.data)
      setNotes(json.data.notes ?? '')
      setTerms(json.data.terms ?? '')
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/settings?group=company')
      .then(r => r.json())
      .then(j => {
        const d = j.data ?? {}
        setCompany({
          name:    d.company_name    ?? '',
          address: d.company_address ?? '',
          phone:   d.company_phone   ?? '',
          email:   d.company_email   ?? '',
          website: d.company_website ?? '',
        })
      })
      .catch(() => {})
  }, [])

  async function saveText() {
    setSavingText(true)
    try {
      const res  = await fetch(`/api/combined-invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, terms }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCombined(json.data)
      toast.success('Saved')
    } catch (err) { toast.error(err.message) }
    finally { setSavingText(false) }
  }

  async function handleDelete() {
    if (!confirm(`Remove combined invoice ${combined?.combinedNumber}? The individual invoices are not affected.`)) return
    try {
      const res = await fetch(`/api/combined-invoices/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Combined invoice removed')
      router.push('/admin/invoices')
    } catch (err) { toast.error(err.message) }
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!combined) return (
    <div className="text-center py-20">
      <p className="text-gray-500">Combined invoice not found.</p>
      <Link href="/admin/invoices" className="text-blue-600 text-sm mt-2 inline-block">Back to invoices</Link>
    </div>
  )

  const s = STATUS_STYLES[combined.status] ?? STATUS_STYLES.SENT
  const t = combined.totals ?? {}
  const project = combined.projectId

  if (printMode) {
    return (
      <div>
        <div className="print:hidden flex items-center gap-3 mb-4 px-4 pt-4">
          <button onClick={() => setPrintMode(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button onClick={() => openCombinedInvoicePrint(combined.combinedNumber)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700">
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>
        <CombinedInvoicePrintView combined={combined} company={company} />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href={project?.id ? `/admin/projects/${project.id}` : '/admin/invoices'}
            className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Layers className="w-4 h-4 text-blue-500" />
              <h1 className="text-xl font-bold text-gray-900 font-mono">{combined.combinedNumber}</h1>
              <span className={`px-2.5 py-1 text-xs font-bold rounded-xl ${s.badge}`}>{s.label}</span>
              <span className="px-2 py-0.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                Combined · {combined.children?.length ?? 0} invoices
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {project?.projectCode ? `${project.projectCode} · ` : ''}{project?.name ?? '—'}
              {combined.clientId?.company ? ` · ${combined.clientId.company}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setPrintMode(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100">
            <Printer className="w-4 h-4" /> Print / PDF
          </button>
          {can('sales.invoices.delete') && (
            <button onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-100 text-red-600 rounded-xl hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          )}
        </div>
      </div>

      {/* Live-derived banner */}
      <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
        <Layers className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800 leading-relaxed">
          Every figure below is recalculated from the child invoices each time this page loads — editing, paying or
          cancelling any of them updates this document automatically.
          {combined.excludedCount > 0 && (
            <> {combined.excludedCount} draft or cancelled invoice{combined.excludedCount === 1 ? '' : 's'} on this project {combined.excludedCount === 1 ? 'is' : 'are'} excluded from the totals.</>
          )}
        </p>
      </div>

      {combined.mixedCurrency && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">
            These invoices are raised in more than one currency. Amounts are summed as entered, with no FX conversion applied.
          </p>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Invoices',    node: <span className="text-gray-900">{t.invoiceCount ?? 0}</span> },
          { label: 'Total Payable', node: <TkAmt value={t.total} decimals={2} />, cls: 'text-gray-900' },
          { label: 'Total Paid',    node: <TkAmt value={t.paidAmount} decimals={2} />, cls: 'text-green-600' },
          { label: 'Total Due',     node: <TkAmt value={t.due} decimals={2} />, cls: t.due > 0.01 ? 'text-red-500' : 'text-green-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{c.label}</p>
            <p className={`text-lg font-bold ${c.cls ?? 'text-gray-900'}`}>{c.node}</p>
          </div>
        ))}
      </div>

      {/* Collection progress */}
      {t.total > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Collection Progress</span>
            <span className="text-sm text-gray-500">
              <TkAmt value={t.paidAmount} decimals={2} /> of <TkAmt value={t.total} decimals={2} />
            </span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${t.paidPct ?? 0}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-green-600 font-medium">{t.paidPct ?? 0}% collected</span>
            {t.due > 0.01 && <span className="text-xs text-amber-600 font-medium">Outstanding: <TkAmt value={t.due} decimals={2} /></span>}
          </div>
        </div>
      )}

      {/* Child invoices */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Included Invoices ({combined.children?.length ?? 0})</h2>
          <p className="text-xs text-gray-400 mt-0.5">Open any invoice to edit it — this document follows.</p>
        </div>
        {(combined.children?.length ?? 0) === 0 ? (
          <div className="py-14 text-center text-sm text-gray-400">No issued invoices for this project yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  {['Invoice No', 'Issued', 'Due Date', 'Status', 'Amount', 'Paid', 'Due', ''].map((h, i) => (
                    <th key={h + i} className={`px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide ${i >= 4 && i <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {combined.children.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="text-sm font-mono font-medium text-gray-800">{c.invoiceNumber}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600 whitespace-nowrap">{fmtDate(c.issueDate)}</td>
                    <td className="px-5 py-3 text-sm text-gray-600 whitespace-nowrap">{fmtDate(c.dueDate)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${CHILD_BADGE[c.status] ?? CHILD_BADGE.DRAFT}`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-gray-900 whitespace-nowrap"><TkAmt value={c.total} decimals={2} /></td>
                    <td className="px-5 py-3 text-right text-sm text-green-600 whitespace-nowrap"><TkAmt value={c.paidAmount} decimals={2} /></td>
                    <td className={`px-5 py-3 text-right text-sm font-semibold whitespace-nowrap ${c.due > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                      <TkAmt value={c.due} decimals={2} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/admin/invoices/${c.id}`}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                        Open <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes & terms */}
      {can('sales.invoices.update') && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Notes & Terms</h2>
            <p className="text-xs text-gray-400 mt-0.5">Shown on the combined invoice document only.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes (visible to client)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Payment Terms</label>
              <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={saveText} disabled={savingText}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-800 disabled:opacity-50">
              {savingText ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
          </div>
        </div>
      )}

      {/* Document preview */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <CombinedInvoicePrintView combined={combined} company={company} />
      </div>
    </div>
  )
}
