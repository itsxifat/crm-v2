'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Printer, Layers, CheckCircle, Clock, AlertCircle, ExternalLink, CreditCard,
} from 'lucide-react'
import CombinedInvoicePrintView, { openCombinedInvoicePrint } from '@/components/shared/CombinedInvoicePrintView'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtAmt  = (n) => `৳ ${(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`

const STATUS_MAP = {
  SENT:           { label: 'Awaiting Payment', bg: 'bg-blue-100',   text: 'text-blue-700',   icon: Clock },
  PARTIALLY_PAID: { label: 'Partially Paid',   bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock },
  PAID:           { label: 'Paid',             bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle },
  OVERDUE:        { label: 'Overdue',          bg: 'bg-red-100',    text: 'text-red-600',    icon: AlertCircle },
  EMPTY:          { label: 'No Invoices',      bg: 'bg-gray-100',   text: 'text-gray-500',   icon: Clock },
}

const CHILD_BADGE = {
  SENT:           'bg-blue-100 text-blue-700',
  PARTIALLY_PAID: 'bg-yellow-100 text-yellow-700',
  PAID:           'bg-green-100 text-green-700',
  OVERDUE:        'bg-red-100 text-red-600',
  CANCELLED:      'bg-gray-100 text-gray-400',
}

export default function ClientCombinedInvoicePage() {
  const { id }  = useParams()
  const router  = useRouter()
  const [combined, setCombined] = useState(null)
  const [company,  setCompany]  = useState({})
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/client/combined-invoices/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Not found')
      setCombined(json.data)
    } catch (err) {
      toast.error(err.message)
      router.push('/client/invoices')
    } finally {
      setLoading(false)
    }
  }, [id, router])

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

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-gray-100 rounded w-40" />
      <div className="h-24 bg-gray-100 rounded-2xl" />
      <div className="h-48 bg-gray-100 rounded-2xl" />
    </div>
  )

  if (!combined) return null

  const status     = STATUS_MAP[combined.status] ?? STATUS_MAP.SENT
  const StatusIcon = status.icon
  const t          = combined.totals ?? {}
  const project    = combined.projectId
  const payable    = (combined.children ?? []).filter(c => ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(c.status))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/client/invoices"
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-500" />
              <h1 className="text-xl font-bold text-gray-900">{combined.combinedNumber}</h1>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Combined statement · {project?.name ?? '—'}
              {project?.projectCode ? ` (${project.projectCode})` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
            <StatusIcon className="w-3.5 h-3.5" />
            {status.label}
          </span>
          <button onClick={() => openCombinedInvoicePrint(combined.combinedNumber)}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
            <Printer className="w-4 h-4" /> Print / PDF
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Invoices',      value: String(t.invoiceCount ?? 0), cls: 'text-gray-900' },
          { label: 'Total Payable', value: fmtAmt(t.total),             cls: 'text-gray-900' },
          { label: 'Total Paid',    value: fmtAmt(t.paidAmount),        cls: 'text-green-600' },
          { label: 'Total Due',     value: fmtAmt(t.due),               cls: t.due > 0.01 ? 'text-red-500' : 'text-green-600' },
        ].map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-base font-bold mt-0.5 ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {t.total > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Payment Progress</span>
            <span className="text-sm text-gray-500">{fmtAmt(t.paidAmount)} of {fmtAmt(t.total)}</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${t.paidPct ?? 0}%` }} />
          </div>
          <p className="text-xs text-green-600 font-medium mt-1.5">{t.paidPct ?? 0}% paid</p>
        </div>
      )}

      {/* Child invoices */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Invoices in this statement ({combined.children?.length ?? 0})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Invoice', 'Due Date', 'Status', 'Amount', 'Paid', 'Due', ''].map((h, i) => (
                  <th key={h + i} className={`px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide ${i >= 3 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(combined.children ?? []).map(c => (
                <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-900">{c.invoiceNumber}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(c.issueDate)}</p>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">{fmtDate(c.dueDate)}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${CHILD_BADGE[c.status] ?? CHILD_BADGE.SENT}`}>
                      {c.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-gray-900 whitespace-nowrap">{fmtAmt(c.total)}</td>
                  <td className="px-5 py-3.5 text-right text-sm text-green-600 whitespace-nowrap">{fmtAmt(c.paidAmount)}</td>
                  <td className={`px-5 py-3.5 text-right text-sm font-semibold whitespace-nowrap ${c.due > 0.01 ? 'text-red-500' : 'text-green-600'}`}>{fmtAmt(c.due)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <Link href={`/client/invoices/${c.id}`}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(c.status)
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'text-blue-600 hover:text-blue-700 border border-blue-100 hover:border-blue-300'
                      }`}>
                      {['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(c.status) ? 'Pay' : 'View'}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {payable.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-50 flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs text-gray-500">
              Payments are submitted against an individual invoice — open any of the {payable.length} outstanding
              invoice{payable.length === 1 ? '' : 's'} above to pay it.
            </p>
          </div>
        )}
      </div>

      {/* Document */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <CombinedInvoicePrintView combined={combined} company={company} />
      </div>
    </div>
  )
}
