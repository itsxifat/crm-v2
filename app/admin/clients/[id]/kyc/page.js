'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ShieldCheck, ShieldX, Clock, AlertCircle, Upload, FileText, Check, X, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import FileUpload from '@/components/ui/FileUpload'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import { PageLoader } from '@/components/ui/LoadingSpinner'

const KYC_STATUS = {
  NOT_SUBMITTED: { label: 'Not submitted',  variant: 'default', Icon: AlertCircle },
  PENDING:       { label: 'Pending review', variant: 'warning', Icon: Clock       },
  VERIFIED:      { label: 'Verified',       variant: 'success', Icon: ShieldCheck },
  REJECTED:      { label: 'Rejected',       variant: 'danger',  Icon: ShieldX     },
}

const DOC_TYPES = [
  { value: 'NID',           label: 'National ID (NID)' },
  { value: 'PASSPORT',      label: 'Passport'          },
  { value: 'TRADE_LICENSE', label: 'Trade license'     },
  { value: 'OTHERS',        label: 'Others'            },
]

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

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

  if (loading) return <PageLoader />
  if (!client) return null

  const kyc    = client.kyc ?? {}
  const status = kyc.status ?? 'NOT_SUBMITTED'
  const sm     = KYC_STATUS[status]
  const SmIcon = sm.Icon
  const locked = status === 'VERIFIED'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="KYC verification"
        back={`/admin/clients/${id}`}
        description={`${client.userId?.name ?? ''} · ${client.clientCode ?? ''}`}
        meta={
          <Badge variant={sm.variant} size="md">
            <SmIcon className="size-3.5" />
            {sm.label}
          </Badge>
        }
      >
        {(kyc.submittedAt || kyc.reviewedAt) && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {kyc.submittedAt && <>Submitted {fmtDate(kyc.submittedAt)}</>}
            {kyc.submittedAt && kyc.reviewedAt && ' · '}
            {kyc.reviewedAt && <>Reviewed {fmtDate(kyc.reviewedAt)} by {kyc.reviewedBy?.name ?? '—'}</>}
          </p>
        )}
      </PageHeader>

      {/* Rejection Remarks */}
      {status === 'REJECTED' && kyc.remarks && (
        <div className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <ShieldX className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Rejection reason</p>
            <p className="mt-0.5 text-red-700">{kyc.remarks}</p>
          </div>
        </div>
      )}

      {/* KYC Form */}
      <Card as="form" onSubmit={submitKyc}>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Document type" required>
            <NativeSelect
              value={form.documentType}
              onChange={e => setForm(f => ({ ...f, documentType: e.target.value }))}
              disabled={locked}
            >
              <option value="">Select…</option>
              {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Document number">
            <Input
              value={form.documentNumber}
              onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))}
              placeholder="Optional"
              disabled={locked}
            />
          </Field>

          <Field label="Primary document" required hint={!locked ? 'NID, passport or trade license' : undefined} className="sm:col-span-2">
            {!locked ? (
              <FileUpload
                label={null}
                value={form.primaryDoc}
                onUploaded={url => setForm(f => ({ ...f, primaryDoc: url }))}
              />
            ) : form.primaryDoc ? (
              <a href={form.primaryDoc} target="_blank" rel="noreferrer"
                className="flex items-center gap-2.5 rounded-lg border border-gray-200/80 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50">
                <FileText className="size-4 shrink-0 text-gray-500" />
                <span className="flex-1">View document</span>
                <ExternalLink className="size-3.5 text-gray-400" />
              </a>
            ) : <p className="text-sm text-muted-foreground">No document uploaded</p>}
          </Field>

          <Field label="Additional documents" className="sm:col-span-2">
            <div className="space-y-2">
              {form.additionalDocs.length > 0 && (
                <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
                  {form.additionalDocs.map((doc, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                      <a href={doc.url} target="_blank" rel="noreferrer"
                        className="flex min-w-0 flex-1 items-center gap-2 truncate py-0.5 text-sm font-medium text-gray-900 hover:underline underline-offset-4">
                        <FileText className="size-4 shrink-0 text-gray-500" />
                        {doc.name || `Document ${i + 1}`}
                      </a>
                      {!locked && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setForm(f => ({ ...f, additionalDocs: f.additionalDocs.filter((_, idx) => idx !== i) }))}
                          className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Remove document"
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!locked && (
                <FileUpload
                  label={null}
                  value=""
                  onUploaded={url => setForm(f => ({ ...f, additionalDocs: [...f.additionalDocs, { url, name: null, uploadedAt: new Date() }] }))}
                />
              )}
              {locked && form.additionalDocs.length === 0 && (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </div>
          </Field>
        </CardContent>

        {!locked && (
          <CardFooter className="justify-end">
            <Button type="submit" loading={saving} variant={status === 'PENDING' ? 'outline' : 'default'}>
              {!saving && <Upload />}
              {status === 'NOT_SUBMITTED' || status === 'REJECTED' ? 'Submit for review' : 'Update documents'}
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Admin Review Panel — only shown for PENDING */}
      {status === 'PENDING' && (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Remarks" hint="Required to reject">
              <Textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                rows={3}
                placeholder="Notes…"
                className="resize-none"
              />
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="outline" onClick={() => reviewKyc('reject')} loading={saving} className="text-red-600 hover:text-red-700">
              {!saving && <X />}
              Reject
            </Button>
            <Button onClick={() => reviewKyc('approve')} loading={saving}>
              {!saving && <Check />}
              Approve
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
