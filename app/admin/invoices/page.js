'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, FileText, Eye, Pencil, Trash2, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import TkAmt from '@/components/ui/TkAmt'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  DRAFT:          { dot: 'bg-gray-400',   label: 'Draft',        ring: 'border-gray-200 bg-gray-50  text-gray-600'   },
  SENT:           { dot: 'bg-blue-500',   label: 'Sent',         ring: 'border-blue-200 bg-blue-50  text-blue-700'   },
  PARTIALLY_PAID: { dot: 'bg-yellow-400', label: 'Partial',      ring: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  PAID:           { dot: 'bg-green-500',  label: 'Paid',         ring: 'border-green-200 bg-green-50  text-green-700'  },
  OVERDUE:        { dot: 'bg-red-500',    label: 'Overdue',      ring: 'border-red-200   bg-red-50    text-red-700'    },
  CANCELLED:      { dot: 'bg-gray-300',   label: 'Cancelled',    ring: 'border-gray-200 bg-gray-50  text-gray-400'   },
}

const STATUS_TABS = [
  ['', 'All'],
  ['DRAFT', 'Draft'],
  ['SENT', 'Sent'],
  ['PARTIALLY_PAID', 'Partial'],
  ['PAID', 'Paid'],
  ['OVERDUE', 'Overdue'],
  ['CANCELLED', 'Cancelled'],
]

const fmt     = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ─── Row 3-dot Menu ───────────────────────────────────────────────────────────

function RowMenu({ inv, onDeleted }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  async function handleDelete() {
    setOpen(false)
    if (!confirm(`Delete invoice ${inv.invoiceNumber}?`)) return
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Invoice deleted')
      onDeleted(inv.id)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 text-sm">
          <button onClick={() => { setOpen(false); router.push(`/admin/invoices/${inv.id}`) }}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
            <Eye className="w-3.5 h-3.5 text-gray-400" /> View Invoice
          </button>
          {inv.status === 'DRAFT' && (
            <button onClick={() => { setOpen(false); router.push(`/admin/invoices/${inv.id}/edit`) }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
              <Pencil className="w-3.5 h-3.5 text-gray-400" /> Edit
            </button>
          )}
          {inv.status === 'DRAFT' && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={handleDelete}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-red-600 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Analytics Bar ────────────────────────────────────────────────────────────

function PaymentAnalytics({ invoices, totalCount }) {
  // Compute counts from loaded invoices — for accurate %, fetch all-status counts via API
  const counts = {
    PAID:           invoices.filter(i => i.status === 'PAID').length,
    PARTIALLY_PAID: invoices.filter(i => i.status === 'PARTIALLY_PAID').length,
    OVERDUE:        invoices.filter(i => i.status === 'OVERDUE').length,
    // Unpaid = SENT + DRAFT (issued but not paid)
    UNPAID:         invoices.filter(i => ['SENT', 'DRAFT'].includes(i.status)).length,
  }

  const total = invoices.length || 1

  const bars = [
    { label: 'Paid',         key: 'PAID',           color: 'bg-green-500', textColor: 'text-green-700', pct: Math.round((counts.PAID / total) * 100) },
    { label: 'Partially Paid', key: 'PARTIALLY_PAID', color: 'bg-yellow-400', textColor: 'text-yellow-700', pct: Math.round((counts.PARTIALLY_PAID / total) * 100) },
    { label: 'Overdue',      key: 'OVERDUE',        color: 'bg-red-500',   textColor: 'text-red-700',   pct: Math.round((counts.OVERDUE / total) * 100) },
    { label: 'Unpaid',       key: 'UNPAID',         color: 'bg-gray-300',  textColor: 'text-gray-600',  pct: Math.round((counts.UNPAID / total) * 100) },
  ]

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      {/* Progress bar */}
      <div className="flex h-2 rounded-full overflow-hidden gap-px mb-4">
        {bars.map(b => (
          <div key={b.key} className={`${b.color} transition-all`} style={{ width: `${b.pct}%` }} />
        ))}
      </div>
      {/* Labels */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {bars.map(b => (
          <div key={b.key}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full ${b.color}`} />
              <span className="text-xs text-gray-500">{b.label}</span>
            </div>
            <p className={`text-lg font-bold ${b.textColor}`}>{b.pct}%</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {b.key === 'UNPAID' ? counts.UNPAID : counts[b.key]}/{total}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const router = useRouter()
  const [invoices,   setInvoices]   = useState([])
  const [meta,       setMeta]       = useState({ page: 1, pages: 1, total: 0 })
  const [loading,    setLoading]    = useState(true)
  const [status,     setStatus]     = useState('')
  const [search,     setSearch]     = useState('')
  const [page,       setPage]       = useState(1)
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page, limit: 20 })
      if (status)    p.set('status',    status)
      if (startDate) p.set('startDate', startDate)
      if (endDate)   p.set('endDate',   endDate)
      const res  = await fetch(`/api/invoices?${p}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setInvoices(json.data ?? [])
      setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, status, startDate, endDate])

  useEffect(() => { load() }, [load])

  function handleDeleted(id) {
    setInvoices(p => p.filter(i => i.id !== id))
    setMeta(m => ({ ...m, total: m.total - 1 }))
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage client invoices and billing</p>
        </div>
        <Link href="/admin/invoices/new"
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> New Invoice
        </Link>
      </div>

      {/* Payment analytics */}
      <PaymentAnalytics invoices={invoices} totalCount={meta.total} />

      {/* Date range + Status tabs row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Status tabs */}
        <div className="flex gap-5 border-b border-gray-100 flex-1">
          {STATUS_TABS.map(([v, l]) => (
            <button key={v} onClick={() => { setStatus(v); setPage(1) }}
              className={`pb-2.5 text-sm transition-colors whitespace-nowrap ${
                status === v
                  ? 'text-gray-900 border-b-2 border-gray-900 font-medium'
                  : 'text-gray-400 hover:text-gray-600'
              }`}>
              {l}
            </button>
          ))}
        </div>
        {/* Date range */}
        <div className="flex items-center gap-2 shrink-0">
          <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); setPage(1) }}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No invoices found</p>
            <Link href="/admin/invoices/new" className="text-blue-600 text-sm mt-2 inline-block hover:underline">
              Create your first invoice
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Invoice No</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Client</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Project</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Invoice Date</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map(inv => {
                  const s = STATUS_META[inv.status] ?? STATUS_META.DRAFT
                  const isOverd = inv.status === 'OVERDUE' || (
                    inv.dueDate && new Date(inv.dueDate) < new Date() && !['PAID', 'CANCELLED'].includes(inv.status)
                  )

                  // Project compact display: code + name
                  const project = inv.projectIds?.[0]
                  const projectLabel = project
                    ? `${project.projectCode ?? ''} ${project.name ?? ''}`.trim()
                    : null

                  return (
                    <tr key={inv.id} onClick={() => router.push(`/admin/invoices/${inv.id}`)}
                      className="hover:bg-gray-50/70 cursor-pointer transition-colors group">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-sm font-mono font-medium text-gray-800">{inv.invoiceNumber}</span>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-gray-900 leading-tight">{inv.clientId?.userId?.name ?? '—'}</p>
                        {inv.clientId?.company && (
                          <p className="text-xs text-gray-400">{inv.clientId.company}</p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {projectLabel ? (
                          <div>
                            <p className="text-xs font-mono text-gray-500">{project?.projectCode}</p>
                            <p className="text-sm text-gray-700 truncate max-w-[160px]">{project?.name}</p>
                            {inv.projectIds?.length > 1 && (
                              <p className="text-xs text-gray-400">+{inv.projectIds.length - 1} more</p>
                            )}
                          </div>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className="text-sm text-gray-600">{fmtDate(inv.issueDate)}</p>
                        {isOverd && (
                          <p className="text-xs text-red-500">Due {fmtDate(inv.dueDate)}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <p className="text-sm font-semibold text-gray-900"><TkAmt value={inv.total} decimals={2} /></p>
                        {inv.paidAmount > 0 && inv.status !== 'PAID' && (
                          <p className="text-xs text-gray-400">Paid: <TkAmt value={inv.paidAmount} decimals={2} /></p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border ${s.ring}`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <RowMenu inv={inv} onDeleted={handleDeleted} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta.pages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-400">Page {page} of {meta.pages} · {meta.total} invoices</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-sm text-gray-500 disabled:opacity-40 hover:text-gray-700 transition-colors">
                Prev
              </button>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm text-gray-500 disabled:opacity-40 hover:text-gray-700 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
