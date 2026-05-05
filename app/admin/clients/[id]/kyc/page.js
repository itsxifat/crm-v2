'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck, ShieldX, Clock, AlertCircle, Upload, FileText, Loader2, Check, X, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import FileUpload from '@/components/ui/FileUpload'

const KYC_STATUS = {
  NOT_SUBMITTED: { label: 'Not Submitted', bg: 'bg-gray-100',   text: 'text-gray-600',  Icon: AlertCircle },
  PENDING:       { label: 'Pending Review',bg: 'bg-yellow-50',  text: 'text-yellow-700',Icon: Clock       },
  VERIFIED:      { label: 'Verified',      bg: 'bg-green-50',   text: 'text-green-700', Icon: ShieldCheck },
  REJECTED:      { label: 'Rejected',      bg: 'bg-red-50',     text: 'text-red-600',   Icon: ShieldX     },
}

const DOC_TYPES = [
  { value: 'NID',           label: 'National ID (NID)' },
  { value: 'PASSPORT',      label: 'Passport'          },
  { value: 'TRADE_LICENSE', label: 'Trade License'     },
  { value: 'OTHERS',        label: 'Others'            },
]

export default function ClientKycPage() {
  const { id }   = useParams()
  const router   = useRouter()
  const [client,   setClient]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [remarks,  setRemarks]  = useState('')
  const [form, setForm] = useState({
    documentType:   '',
    documentNumber: '',
    primaryDoc:     '',
    additionalDocs: [],
  })

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) { toast.error(j.error); router.push('/admin/clients'); return }
        const c = j.data
        setClient(c)
        setForm({
          documentType:   c.kyc?.documentType   ?? '',
          documentNumber: c.kyc?.documentNumber ?? '',
          primaryDoc:     c.kyc?.primaryDoc     ?? '',
          additionalDocs: c.kyc?.additionalDocs ?? [],
        })
      })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false))
  }, [id, router])

  async function submitKyc(e) {
    e.preventDefault()
    if (!form.documentType)  { toast.error('Select a document type'); return }
    if (!form.primaryDoc)    { toast.error('Upload the primary document'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/clients/${id}/kyc`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          documentType:   form.documentType,
          documentNumber: form.documentNumber || null,
          primaryDoc:     form.primaryDoc,
          additionalDocs: form.additionalDocs,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('KYC submitted for review')
      setClient(json.data)
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function reviewKyc(action) {
    if (action === 'reject' && !remarks.trim()) { toast.error('Please provide a rejection reason'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/clients/${id}/kyc`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, remarks: remarks || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'approve' ? 'KYC approved' : 'KYC rejected')
      setClient(json.data)
      setRemarks('')
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div className="flex justify-center py-32">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!client) return null

  const kyc    = client.kyc ?? {}
  const status = kyc.status ?? 'NOT_SUBMITTED'
  const sm     = KYC_STATUS[status]
  const SmIcon = sm.Icon

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/admin/clients/${id}`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">KYC Verification</h1>
          <p className="text-sm text-gray-400">{client.userId?.name} · {client.clientCode}</p>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`flex items-center gap-3 px-5 py-4 rounded-xl border ${sm.bg} border-current/10`}>
        <SmIcon className={`w-5 h-5 ${sm.text} shrink-0`} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${sm.text}`}>{sm.label}</p>
          {kyc.submittedAt && <p className="text-xs text-gray-500 mt-0.5">Submitted: {new Date(kyc.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>}
          {kyc.reviewedAt  && <p className="text-xs text-gray-500 mt-0.5">Reviewed: {new Date(kyc.reviewedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} by {kyc.reviewedBy?.name ?? '—'}</p>}
        </div>
      </div>

      {/* Rejection Remarks */}
      {status === 'REJECTED' && kyc.remarks && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4">
          <p className="text-sm font-medium text-red-700 mb-1">Rejection Reason</p>
          <p className="text-sm text-red-600">{kyc.remarks}</p>
        </div>
      )}

      {/* KYC Form */}
      <form onSubmit={submitKyc} className="bg-white border border-gray-100 rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-700">KYC Documents</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Document Type *</label>
            <select value={form.documentType} onChange={e => setForm(f => ({ ...f, documentType: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={status === 'VERIFIED'}>
              <option value="">— Select type —</option>
              {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Document Number</label>
            <input value={form.documentNumber} onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))}
              placeholder="Optional but recommended"
              disabled={status === 'VERIFIED'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Primary Document *</label>
          {status !== 'VERIFIED' ? (
            <FileUpload
              label="Upload NID / Passport / Trade License (Image or PDF)"
              value={form.primaryDoc}
              onUploaded={url => setForm(f => ({ ...f, primaryDoc: url }))}
            />
          ) : form.primaryDoc ? (
            <a href={form.primaryDoc} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
              <FileText className="w-4 h-4" /> View Document <ExternalLink className="w-3 h-3" />
            </a>
          ) : <p className="text-sm text-gray-400">No document uploaded</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Additional Documents (optional)</label>
          {form.additionalDocs.map((doc, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <a href={doc.url} target="_blank" rel="noreferrer"
                className="flex-1 flex items-center gap-2 text-sm text-blue-600 hover:underline truncate">
                <FileText className="w-4 h-4 shrink-0" />
                {doc.name || `Document ${i + 1}`}
              </a>
              {status !== 'VERIFIED' && (
                <button type="button" onClick={() => setForm(f => ({ ...f, additionalDocs: f.additionalDocs.filter((_, idx) => idx !== i) }))}
                  className="p-1 text-gray-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {status !== 'VERIFIED' && (
            <FileUpload
              label="Add additional document"
              value=""
              onUploaded={url => setForm(f => ({ ...f, additionalDocs: [...f.additionalDocs, { url, name: null, uploadedAt: new Date() }] }))}
            />
          )}
        </div>

        {status !== 'VERIFIED' && (
          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {status === 'NOT_SUBMITTED' || status === 'REJECTED' ? 'Submit for Review' : 'Update Documents'}
            </button>
          </div>
        )}
      </form>

      {/* Admin Review Panel — only shown for PENDING */}
      {status === 'PENDING' && (
        <div className="bg-white border border-gray-100 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Admin Review</h3>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Remarks (required for rejection)</label>
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
              placeholder="Reason for rejection or approval notes…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => reviewKyc('approve')} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Approve KYC
            </button>
            <button onClick={() => reviewKyc('reject')} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              Reject KYC
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
