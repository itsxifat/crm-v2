'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Mail, Phone, Calendar, FileText, Download,
  Upload, Loader2, X, Image,
  Package, Plus, Pencil, BadgeCheck, AlertCircle, ThumbsUp, ThumbsDown, LogOut,
} from 'lucide-react'
import {
  Printer, Undo2, TriangleAlert, RefreshCw, CircleCheckBig, Flag,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import Avatar from '@/components/ui/Avatar'
import TkAmt from '@/components/ui/TkAmt'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Label, Field } from '@/components/ui/Input'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import AssetPicker from '@/components/inventory/AssetPicker'
import AssetStatusBadge, { AssetConditionBadge, InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import EmployeeSalaryTab from '@/components/admin/employees/EmployeeSalaryTab'
import {
  ACK_META, RECOVERY_STATUS_META, RECOVERY_METHOD_LABELS, DAMAGE_CAUSE_LABELS, CONDITION_OPTIONS,
} from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

// 'ANNUAL' → 'Annual' (display only)
const prettyEnum = (s) => s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—'

const ROLE_META = {
  SUPER_ADMIN: { label: 'Super admin', variant: 'danger'  },
  MANAGER:     { label: 'Manager',     variant: 'primary' },
  EMPLOYEE:    { label: 'Employee',    variant: 'default' },
  FREELANCER:  { label: 'Freelancer',  variant: 'purple'  },
  CLIENT:      { label: 'Client',      variant: 'success' },
  VENDOR:      { label: 'Vendor',      variant: 'orange'  },
}

const TASK_STATUS_META = {
  TODO:        { label: 'To do',       variant: 'default' },
  IN_PROGRESS: { label: 'In progress', variant: 'primary' },
  IN_REVIEW:   { label: 'In review',   variant: 'warning' },
  COMPLETED:   { label: 'Completed',   variant: 'success' },
  CANCELLED:   { label: 'Cancelled',   variant: 'danger'  },
}

function RoleBadge({ role }) {
  const m = ROLE_META[role] ?? { label: role, variant: 'default' }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

function InfoRow({ label, value, className }) {
  if (!value) return null
  return (
    <div className={className}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  )
}

// Links styled as tiny ghost icon buttons (print/download in rows).
const iconLink = 'inline-flex size-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900'
// Asset tag link (mono)
const tagLink = 'font-mono text-xs font-medium text-gray-900 underline-offset-4 hover:underline'

// `label` is also saved as the document name on upload — keep it as-is; `display` is for the UI.
const DOC_TYPE_META = {
  NID:               { label: 'National ID (NID)',      display: 'National ID (NID)' },
  BIRTH_CERTIFICATE: { label: 'Birth Certificate',      display: 'Birth certificate' },
  CV:                { label: 'CV / Resume',             display: 'CV / resume' },
  PASSPORT:          { label: 'Passport',                display: 'Passport' },
  ACADEMIC:          { label: 'Academic Certificate',    display: 'Academic certificate' },
  APPOINTMENT:       { label: 'Appointment Letter',      display: 'Appointment letter' },
  AGREEMENT:         { label: 'Agreement / Contract',    display: 'Agreement / contract' },
  PHOTO:             { label: 'Formal Photo',            display: 'Formal photo' },
  OTHER:             { label: 'Other',                   display: 'Other' },
}
const DOC_TYPES = Object.keys(DOC_TYPE_META)

function isImage(url) { return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url) }

function DocCard({ doc, onRemove }) {
  const meta = DOC_TYPE_META[doc.type] ?? DOC_TYPE_META.OTHER
  const name = doc.name || doc.url?.split('/').pop() || 'Document'
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-gray-200/80 p-3 transition-colors hover:bg-gray-50/70">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-gray-100">
        {isImage(doc.url) ? <Image alt="" className="size-4 text-gray-500" /> : <FileText className="size-4 text-gray-500" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{meta.display}</p>
      </div>
      <div className="flex items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <a href={doc.url} target="_blank" rel="noreferrer" className={iconLink} title="Download" aria-label="Download">
          <Download className="size-4" />
        </a>
        {onRemove && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} title="Remove" aria-label="Remove"
            className="text-gray-500 hover:bg-red-50 hover:text-red-600">
            <X />
          </Button>
        )}
      </div>
    </div>
  )
}

function DocumentsTab({ emp, empId, onUpdated }) {
  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [newDocs,   setNewDocs]   = useState([])   // { url, type, name }
  const [addType,   setAddType]   = useState('OTHER')
  const [addName,   setAddName]   = useState('')
  const fileRef = useRef(null)

  const systemDocs = [
    emp.photo            && { url: emp.photo,            type: 'PHOTO',       name: 'Formal photo',        _system: true },
    emp.appointmentLetterUrl && { url: emp.appointmentLetterUrl, type: 'APPOINTMENT', name: 'Appointment letter', _system: true },
    emp.agreementUrl     && { url: emp.agreementUrl,     type: 'AGREEMENT',   name: 'Agreement / contract', _system: true },
    ...( emp.documents ?? []).map(d => ({ ...d, _system: false })),
  ].filter(Boolean)

  async function handleUpload(file) {
    if (!file) return
    if (addType === 'OTHER' && !addName.trim()) {
      toast.error('Enter a document name for "Other"')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      const docName = addType === 'OTHER' ? (addName.trim() || file.name) : (DOC_TYPE_META[addType]?.label || file.name)
      setNewDocs(d => [...d, { url: json.url, type: addType, name: docName }])
      setAddName('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSave() {
    if (newDocs.length === 0) return
    setSaving(true)
    try {
      const allDocs = [...(emp.documents ?? []), ...newDocs]
      const res  = await fetch(`/api/employees/${empId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: allDocs }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      onUpdated(json.data)
      setNewDocs([])
      toast.success('Documents saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(index) {
    const updated = (emp.documents ?? []).filter((_, i) => i !== index)
    setSaving(true)
    try {
      const res  = await fetch(`/api/employees/${empId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: updated }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Remove failed')
      onUpdated(json.data)
      toast.success('Document removed')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Existing docs */}
      <Card>
        <CardHeader>
          <CardTitle>
            Documents
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">{systemDocs.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {systemDocs.length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet" className="rounded-lg border border-dashed border-gray-200 py-8" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {systemDocs.map((doc, i) => (
                <DocCard key={i} doc={doc}
                  onRemove={doc._system ? null : () => handleRemove(
                    (emp.documents ?? []).findIndex((d, di) => d.url === doc.url && di === i - systemDocs.filter(s => s._system).length)
                  )}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload new */}
      <Card>
        <CardHeader>
          <CardTitle>Upload document</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Type" htmlFor="doc-type" className="w-full sm:w-56">
              <NativeSelect id="doc-type" value={addType} onChange={e => { setAddType(e.target.value); setAddName('') }}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_META[t].display}</option>)}
              </NativeSelect>
            </Field>
            {addType === 'OTHER' && (
              <Field label="Name" htmlFor="doc-name" required className="min-w-[180px] flex-1">
                <Input id="doc-name" value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. Medical certificate" />
              </Field>
            )}
            <div className="min-w-[180px] flex-1">
              <Label>File</Label>
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="w-full border-dashed">
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                {uploading ? 'Uploading…' : 'Choose file'}
              </Button>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={e => handleUpload(e.target.files?.[0])} />
            </div>
          </div>

          {/* Staged new docs */}
          {newDocs.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-gray-100 pt-5">
              <p className="text-[13px] text-muted-foreground">{newDocs.length} ready to save</p>
              {newDocs.map((doc, i) => (
                <DocCard key={i} doc={doc} onRemove={() => setNewDocs(d => d.filter((_, j) => j !== i))} />
              ))}
              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} loading={saving}>Save documents</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Assets (inventory register) ─────────────────────────────────────────────

const CASE_TYPE_LABEL = (c) => {
  if (c.type === 'LOST') return 'Lost'
  if (c.type === 'STOLEN') return 'Stolen'
  return c.reportType === 'NOT_WORKING' ? 'Fault' : 'Damage'
}

/** POST an asset action to the inventory API (built by the assets module). */
async function postAssetAction(assetId, body) {
  const res  = await fetch(`/api/inventory/assets/${assetId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const fe = json.details?.fieldErrors
    const first = fe ? Object.values(fe).flat()[0] : null
    throw new Error(first || json.error || 'Action failed')
  }
  return json.data
}

function AssignAssetModal({ open, empId, empName, onClose, onDone }) {
  const [assetId, setAssetId]   = useState(null)
  const [expectedReturnDate, setExpectedReturnDate] = useState(null)
  const [condition, setCondition] = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    if (!open) return
    setAssetId(null); setExpectedReturnDate(null); setCondition(''); setNotes('')
  }, [open])

  async function submit(e) {
    e?.preventDefault()
    if (!assetId) { toast.error('Choose an asset that is in stock'); return }
    setSaving(true)
    try {
      await postAssetAction(assetId, {
        action: 'assign',
        employeeId: empId,
        ...(expectedReturnDate ? { expectedReturnDate } : {}),
        ...(condition ? { condition } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      toast.success(`Assigned to ${empName ?? 'the employee'}`)
      onDone()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="md" title="Assign asset"
      description={empName ? `From stock to ${empName}` : undefined}>
      <form id="assign-asset-form" onSubmit={submit} className="space-y-4">
        <div title="If the category requires it, the employee must acknowledge receipt in My Assets.">
          <Label required>Asset in stock</Label>
          <AssetPicker value={assetId} onChange={(id) => setAssetId(id)} statuses={['IN_STOCK']} placeholder="Search tag, name or serial…" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Expected return">
            <DatePicker value={expectedReturnDate} onChange={setExpectedReturnDate} placeholder="No return date" />
          </Field>
          <Field label="Condition at handover" htmlFor="assign-cond">
            <NativeSelect id="assign-cond" value={condition} onChange={e => setCondition(e.target.value)}>
              <option value="">As recorded</option>
              {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Notes" htmlFor="assign-notes">
          <Textarea id="assign-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000}
            className="min-h-0" placeholder="e.g. With charger and bag" />
        </Field>
      </form>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="assign-asset-form" loading={saving} disabled={!assetId}>Assign</Button>
      </ModalFooter>
    </Modal>
  )
}

function ReturnAssetModal({ asset, onClose, onDone }) {
  const [condition, setCondition] = useState('GOOD')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    if (!asset) return
    setCondition(asset.condition ?? 'GOOD'); setNotes('')
  }, [asset])

  async function submit(e) {
    e?.preventDefault()
    setSaving(true)
    try {
      await postAssetAction(asset.id, { action: 'return', condition, ...(notes.trim() ? { notes: notes.trim() } : {}) })
      toast.success(`${asset.assetTag} returned to stock`)
      onDone()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!asset} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm" title="Return to stock"
      description={asset ? `${asset.assetTag} · ${asset.name}` : undefined}>
      {asset && (
        <form id="return-asset-form" onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="return-cond">Condition on return</Label>
            <NativeSelect id="return-cond" value={condition} onChange={e => setCondition(e.target.value)}>
              {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
            {condition === 'BROKEN' && <p className="mt-1.5 text-xs text-amber-700">Recorded as damaged, awaiting a decision.</p>}
          </div>
          <Field label="Notes" htmlFor="return-notes">
            <Textarea id="return-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000}
              className="min-h-0" placeholder="e.g. Charger missing" />
          </Field>
        </form>
      )}
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="return-asset-form" loading={saving}>Return</Button>
      </ModalFooter>
    </Modal>
  )
}

function AssetsTab({ empId, empName }) {
  const { can, canAny } = usePermission()
  const canAssign  = can('inventory.assign')
  const canOpenAsset = canAny(['inventory.view', 'inventory.manage'])
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [assignOpen, setAssignOpen]     = useState(false)
  const [returnTarget, setReturnTarget] = useState(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`/api/employees/${empId}/assets`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load assets')
      setData(json.data)
    } catch (err) {
      setError(err.message || 'Failed to load assets')
    } finally {
      setLoading(false)
    }
  }, [empId])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
  }
  if (error && !data) {
    return (
      <Card>
        <EmptyState
          icon={AlertCircle}
          title={error}
          action={<Button variant="outline" onClick={load}><RefreshCw /> Try again</Button>}
        />
      </Card>
    )
  }
  if (!data) return null

  const { assets = [], damageCases = [], consumables, returned = [], summary = {}, canViewFinancials } = data
  const pending  = assets.filter(a => a.acknowledgement?.status === 'PENDING')
  const declined = assets.filter(a => a.acknowledgement?.status === 'DECLINED')
  const tagCell = (a) => canOpenAsset
    ? <Link href={`/admin/inventory/assets/${a.id}`} className={tagLink}>{a.assetTag}</Link>
    : <span className="font-mono text-xs text-gray-500">{a.assetTag}</span>

  return (
    <div className="space-y-6">
      {/* Summary & actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{summary.held ?? 0} held</Badge>
          {summary.pendingAcknowledgement > 0 && (
            <Badge variant="warning">{summary.pendingAcknowledgement} awaiting acknowledgement</Badge>
          )}
          {summary.declined > 0 && <Badge variant="danger">{summary.declined} declined</Badge>}
          {summary.overdueReturns > 0 && <Badge variant="danger">{summary.overdueReturns} overdue return</Badge>}
          {summary.openDamageCases > 0 && <Badge variant="orange">{summary.openDamageCases} recovery pending{canViewFinancials && summary.recoveryOutstanding > 0 ? <> · <TkAmt value={summary.recoveryOutstanding} /></> : null}</Badge>}
          {summary.awaitingAssessment > 0 && <Badge variant="orange">{summary.awaitingAssessment} reported problem{summary.awaitingAssessment === 1 ? '' : 's'}</Badge>}
          {canViewFinancials && summary.heldCost > 0 && (
            <Badge variant="outline">Book value <TkAmt value={summary.heldBookValue} /></Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button variant="outline" size="icon-sm" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh">
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
          {assets.length > 0 && (
            <a href={`/api/employees/${empId}/assets/handover`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Printer /> Handover form
            </a>
          )}
          {canAssign && (
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <Plus /> Assign asset
            </Button>
          )}
        </div>
      </div>

      {/* Exit clearance */}
      <div className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        summary.clearance?.clear ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
      )}>
        {summary.clearance?.clear ? <CircleCheckBig className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
        <div>
          <p className="font-medium">{summary.clearance?.clear ? 'Clear for exit — nothing outstanding' : 'Not clear for exit yet'}</p>
          {!summary.clearance?.clear && <p className="mt-0.5 text-xs">{(summary.clearance?.reasons ?? []).join(' · ')}</p>}
        </div>
      </div>

      {(pending.length > 0 || declined.length > 0) && (
        <Card className="space-y-2 p-5">
          <CardTitle>Acknowledgements</CardTitle>
          {pending.map(a => (
            <p key={a.id} className="text-[13px] text-gray-600">
              {tagCell(a)} <span className="ml-1">{a.name}</span> — waiting since {fmtDate(a.assignedAt)}
            </p>
          ))}
          {declined.map(a => (
            <p key={a.id} className="text-[13px] text-red-700">
              {tagCell(a)} <span className="ml-1">{a.name}</span> — declined {fmtDate(a.acknowledgement?.at)}{a.acknowledgement?.note ? `: “${a.acknowledgement.note}”` : ''}
            </p>
          ))}
        </Card>
      )}

      {/* Held assets */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle>Assigned equipment</CardTitle>
        </CardHeader>
        {assets.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No assets assigned"
            className="pt-4"
            action={canAssign ? <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>Assign from stock</Button> : undefined}
          />
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Acknowledgement</TableHead>
                <TableHead>Issued</TableHead>
                {canViewFinancials && <TableHead className="text-right">Book value</TableHead>}
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map(a => {
                const ack = a.acknowledgement?.status ?? 'NOT_REQUIRED'
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      {tagCell(a)}
                      <p className="text-sm text-gray-900">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{[a.category?.name, [a.brand, a.model].filter(Boolean).join(' '), a.serialNumber ? `S/N ${a.serialNumber}` : null].filter(Boolean).join(' · ')}</p>
                    </TableCell>
                    <TableCell><AssetStatusBadge status={a.status} /></TableCell>
                    <TableCell><AssetConditionBadge condition={a.condition} /></TableCell>
                    <TableCell>
                      {ack === 'NOT_REQUIRED'
                        ? <span className="text-xs text-muted-foreground">Not required</span>
                        : <InventoryBadge label={ACK_META[ack]?.label ?? ack} color={ACK_META[ack]?.color ?? 'gray'} />}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <p className="text-gray-700 tabular-nums">{fmtDate(a.assignedAt)}</p>
                      {a.expectedReturnDate && (
                        <p className={a.overdue ? 'font-medium text-red-600' : 'text-muted-foreground'}>Return by {fmtDate(a.expectedReturnDate)}</p>
                      )}
                    </TableCell>
                    {canViewFinancials && (
                      <TableCell className="whitespace-nowrap text-right"><TkAmt value={a.bookValue} /></TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <a href={`/api/my-assets/${a.id}/handover`} target="_blank" rel="noreferrer" title="Print handover form"
                          className={iconLink} aria-label={`Print handover form for ${a.assetTag}`}>
                          <Printer className="size-4" />
                        </a>
                        {canAssign && a.status === 'ASSIGNED' && (
                          <Button variant="outline" size="xs" onClick={() => setReturnTarget(a)}>
                            <Undo2 className="size-3.5" /> Return
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Damage / loss cases */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div>
            <CardTitle>Damage &amp; loss cases</CardTitle>
            <CardDescription>Pay recovery only for loss caused by neglect, after an enquiry (Labour Act 2006 s.125/127).</CardDescription>
          </div>
        </CardHeader>
        {damageCases.length === 0 ? (
          <p className="px-5 pb-8 pt-3 text-center text-sm text-muted-foreground">No damage or loss recorded</p>
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Liability</TableHead>
                <TableHead>Recovery</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {damageCases.map(c => {
                const rec = c.recovery
                const recMeta = rec?.status ? RECOVERY_STATUS_META[rec.status] : null
                return (
                  <TableRow key={c.id} className="align-top">
                    <TableCell className="whitespace-nowrap align-top text-xs tabular-nums">{fmtDate(c.date)}</TableCell>
                    <TableCell className="align-top">
                      {c.asset ? (canOpenAsset
                        ? <Link href={`/admin/inventory/assets/${c.asset.id}`} className={tagLink}>{c.asset.assetTag}</Link>
                        : <span className="font-mono text-xs text-gray-500">{c.asset.assetTag}</span>) : '—'}
                      <p className="text-xs text-muted-foreground">{c.asset?.name}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm text-gray-900">{CASE_TYPE_LABEL(c)}</span>
                        {c.cause && c.cause !== 'UNKNOWN' && <span className="text-xs text-muted-foreground">· {DAMAGE_CAUSE_LABELS[c.cause] ?? c.cause}</span>}
                        {c.reportedByEmployee && (
                          <Badge variant="default"><Flag className="size-3" /> Self-reported</Badge>
                        )}
                        {c.awaitingAssessment && <Badge variant="orange">Awaiting assessment</Badge>}
                      </div>
                      {c.description && <p className="mt-0.5 max-w-sm text-xs text-muted-foreground">{c.description}</p>}
                      {c.gdNumber && <p className="mt-0.5 text-xs text-muted-foreground">GD no. {c.gdNumber}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-xs">
                      {c.isResponsible ? <p className="text-gray-900">Held responsible{c.liabilityPct != null ? ` (${c.liabilityPct}%)` : ''}</p> : <p className="text-gray-400">—</p>}
                      {canViewFinancials && c.assessedLoss != null && <p>Loss <TkAmt value={c.assessedLoss} /></p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-xs">
                      {rec ? (
                        <div className="space-y-1">
                          {recMeta && <InventoryBadge label={recMeta.label} color={recMeta.color} />}
                          <p className="text-muted-foreground">
                            {RECOVERY_METHOD_LABELS[rec.method] ?? rec.method ?? ''}
                            {canViewFinancials && rec.amount != null ? <> · <TkAmt value={rec.amount} /></> : null}
                          </p>
                          {canViewFinancials && Number(rec.recoveredAmount) > 0 && rec.status !== 'RECOVERED' && (
                            <p className="text-muted-foreground">
                              Recovered <TkAmt value={rec.recoveredAmount} />
                              {rec.status === 'PENDING' && Number(rec.outstanding) > 0 ? <> · balance <TkAmt value={rec.outstanding} /></> : null}
                            </p>
                          )}
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Consumables */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle>Supplies issued</CardTitle>
          {canViewFinancials && consumables?.totals?.value > 0 && (
            <CardAction className="text-[13px] text-muted-foreground">Value <TkAmt value={consumables.totals.value} /></CardAction>
          )}
        </CardHeader>
        {(consumables?.items ?? []).length === 0 ? (
          <p className="px-5 pb-8 pt-3 text-center text-sm text-muted-foreground">No supplies issued yet</p>
        ) : (
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead>Last issued</TableHead>
                {canViewFinancials && <TableHead className="text-right">Value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {consumables.items.map((i, idx) => (
                <TableRow key={i.stockItem?.id ?? idx}>
                  <TableCell className="py-2.5">
                    <p className="text-gray-900">{i.stockItem?.name ?? '—'}</p>
                    {i.stockItem?.sku && <p className="font-mono text-xs text-muted-foreground">{i.stockItem.sku}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-right tabular-nums">{i.issued} {i.stockItem?.unit ?? ''}</TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-right text-gray-500 tabular-nums">{i.returned || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-xs text-gray-500 tabular-nums">{fmtDate(i.lastIssuedAt)}</TableCell>
                  {canViewFinancials && <TableCell className="whitespace-nowrap py-2.5 text-right"><TkAmt value={i.value} /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Returned history */}
      {returned.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle>Previously returned</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-gray-100 border-t border-gray-100">
            {returned.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                {r.asset ? (canOpenAsset
                  ? <Link href={`/admin/inventory/assets/${r.asset.id}`} className={tagLink}>{r.asset.assetTag}</Link>
                  : <span className="font-mono text-xs text-gray-500">{r.asset.assetTag}</span>) : null}
                <span className="text-gray-900">{r.asset?.name ?? '—'}</span>
                {r.condition && <AssetConditionBadge condition={r.condition} />}
                <span className="text-xs text-muted-foreground sm:ml-auto">{fmtDate(r.date)}{r.by ? ` · ${r.by}` : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AssignAssetModal open={assignOpen} empId={empId} empName={empName} onClose={() => setAssignOpen(false)}
        onDone={() => { setAssignOpen(false); load() }} />
      <ReturnAssetModal asset={returnTarget} onClose={() => setReturnTarget(null)}
        onDone={() => { setReturnTarget(null); load() }} />
    </div>
  )
}

function CompanyItemFields({ form, setForm, withPlaceholders }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="Item" required>
        <Input list="item-presets" value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
          placeholder={withPlaceholders ? 'e.g. Laptop' : undefined} />
      </Field>
      <Field label="Serial / model / value">
        <Input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
          placeholder={withPlaceholders ? 'e.g. ThinkPad X1 / SN-2345' : undefined} />
      </Field>
      <Field label="Note">
        <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder={withPlaceholders ? 'Optional' : undefined} />
      </Field>
    </div>
  )
}

function CompanyItemsTab({ emp, empId, onUpdated, onGoToAssets }) {
  const [items,        setItems]        = useState(() => (emp.companyItems ?? []).map((it, i) => ({ ...it, _id: i })))
  const [itemPresets,  setItemPresets]  = useState([])
  const [saving,  setSaving]  = useState(false)
  const [editIdx, setEditIdx] = useState(null)   // index being edited inline
  const [form,    setForm]    = useState({ item: '', value: '', description: '' })
  const [adding,  setAdding]  = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(j => setItemPresets(j.data?.companyItemCategories ?? []))
      .catch(() => {})
  }, [])

  function openAdd() { setForm({ item: '', value: '', description: '' }); setAdding(true); setEditIdx(null) }
  function openEdit(i) { setForm({ ...items[i] }); setEditIdx(i); setAdding(false) }
  function cancelForm() { setAdding(false); setEditIdx(null) }

  function commitAdd() {
    if (!form.item.trim()) { toast.error('Item name is required'); return }
    setItems(prev => [...prev, { ...form, _id: Date.now() }])
    setAdding(false)
  }

  function commitEdit() {
    if (!form.item.trim()) { toast.error('Item name is required'); return }
    setItems(prev => prev.map((it, i) => i === editIdx ? { ...form, _id: it._id } : it))
    setEditIdx(null)
  }

  function removeItem(i) { setItems(prev => prev.filter((_, idx) => idx !== i)) }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = items.map(({ _id, ...rest }) => rest)
      const res  = await fetch(`/api/employees/${empId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyItems: payload }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      onUpdated(json.data)
      setItems((json.data.companyItems ?? []).map((it, i) => ({ ...it, _id: i })))
      toast.success('Company items saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = JSON.stringify(items.map(({ _id, ...r }) => r)) !==
                  JSON.stringify((emp.companyItems ?? []))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-[220px] flex-1">
          <p className="font-medium">Legacy list — issue new equipment from Assets</p>
          <p className="mt-0.5 text-xs">
            Admins can convert these with <code className="font-mono">npm run db:migrate-company-items</code>.
          </p>
        </div>
        {onGoToAssets && (
          <Button variant="outline" size="sm" onClick={onGoToAssets}>
            <Package /> Go to assets
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company items</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" onClick={openAdd}>
              <Plus /> Add item
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-3">
          <datalist id="item-presets">
            {itemPresets.map(p => <option key={p} value={p} />)}
          </datalist>

          {/* Add form */}
          {adding && (
            <div className="space-y-3 rounded-lg bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-900">New item</p>
              <CompanyItemFields form={form} setForm={setForm} withPlaceholders />
              <div className="flex gap-2">
                <Button size="sm" onClick={commitAdd}>Add</Button>
                <Button variant="ghost" size="sm" onClick={cancelForm}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Items list */}
          {items.length === 0 && !adding ? (
            <EmptyState icon={Package} title="No items yet" className="rounded-lg border border-dashed border-gray-200 py-8" />
          ) : items.length > 0 && (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
              {items.map((it, i) => (
                <div key={it._id}>
                  {editIdx === i ? (
                    <div className="space-y-3 bg-gray-50 p-4">
                      <CompanyItemFields form={form} setForm={setForm} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={commitEdit}>Save</Button>
                        <Button variant="ghost" size="sm" onClick={cancelForm}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="group flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50/70">
                      <Package className="size-4 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{it.item}</p>
                        {it.value && <p className="mt-0.5 text-xs text-muted-foreground">{it.value}</p>}
                        {it.description && <p className="mt-0.5 text-xs italic text-gray-400">{it.description}</p>}
                      </div>
                      <div className="flex items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <Button variant="ghost" size="icon-xs" onClick={() => openEdit(i)} title="Edit" aria-label="Edit">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => removeItem(i)} title="Remove" aria-label="Remove"
                          className="hover:bg-red-50 hover:text-red-600">
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>

        {/* Save button */}
        {isDirty && (
          <CardFooter className="justify-end">
            <Button onClick={handleSave} loading={saving}>Save changes</Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}

// ─── Profile Status / Review Card ────────────────────────────────────────────

const PROFILE_STATUS_META = {
  CREATED:          { label: 'Not started',       variant: 'default' },
  INCOMPLETE:       { label: 'Incomplete',        variant: 'warning' },
  PENDING_APPROVAL: { label: 'Pending HR review', variant: 'primary' },
  APPROVED:         { label: 'Approved',          variant: 'success' },
}

function ProfileProgressBar({ pct }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    setDisplay(0)
    if (pct <= 0) return
    // Build milestone steps: every 10% increment up to actual pct
    const steps = []
    for (let i = 10; i <= pct; i += 10) steps.push(i)
    if (steps.length === 0) return

    let idx = 0
    const id = setInterval(() => {
      setDisplay(steps[idx])
      idx++
      if (idx >= steps.length) clearInterval(id)
    }, 300)

    return () => clearInterval(id)
  }, [pct])

  return (
    <>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Completion</span>
        <span className={cn('font-medium tabular-nums', display === 100 ? 'text-emerald-600' : 'text-gray-900')}>{display}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100">
        <div className={cn('h-1.5 rounded-full transition-all duration-500', display === 100 ? 'bg-emerald-500' : 'bg-gray-900')} style={{ width: `${display}%` }} />
      </div>
    </>
  )
}

function ProfileReviewCard({ emp, empId, onUpdated }) {
  const pct    = emp.profileCompletionPct ?? 0
  const status = emp.profileStatus ?? 'CREATED'
  const meta   = PROFILE_STATUS_META[status] ?? PROFILE_STATUS_META.INCOMPLETE

  const [approving, setApproving] = useState(false)
  const [notes,     setNotes]     = useState(emp.hrNotes ?? '')
  const [showNotes, setShowNotes] = useState(false)

  async function handleAction(action) {
    setApproving(true)
    try {
      const res  = await fetch(`/api/admin/employees/${empId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: notes.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Action failed')
      toast.success(json.message)
      const d = json.data
      onUpdated(prev => ({
        ...prev,
        profileStatus:      d.profileStatus,
        panelAccessGranted: d.panelAccessGranted,
        finalApproved:      d.finalApproved,
        kycApproved:        d.kycApproved,
        hrNotes:            d.hrNotes ?? prev.hrNotes,
      }))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setApproving(false)
    }
  }

  // Employee-filled fields for display
  const personalItems = [
    { label: 'Gender',         value: emp.gender },
    { label: 'Date of birth',  value: emp.dateOfBirth ? new Date(emp.dateOfBirth).toLocaleDateString('en-GB') : null },
    { label: 'Nationality',    value: emp.nationality },
    { label: 'Marital status', value: emp.maritalStatus },
    { label: 'Photo',          value: emp.photo ? 'Uploaded' : null },
  ]
  const contactItems = [
    { label: 'Phone',             value: emp.phone },
    { label: 'Alt phone',         value: emp.secondaryPhone },
    { label: 'Address',           value: emp.address },
    ...(emp.emergencyContacts ?? []).map((c, i) => ({
      label: i === 0 ? 'Emergency contact' : `Emergency contact ${i + 1}`,
      value: c.name ? `${c.name} (${c.relation}) · ${c.phone}` : null,
    })),
  ]
  const kycItems = [
    { label: 'NID number',      value: emp.nidNumber },
    { label: 'Passport number', value: emp.passportNumber },
    { label: 'Documents',       value: (emp.documents ?? []).length > 0 ? `${emp.documents.length} file(s)` : null },
  ]

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Profile onboarding</CardTitle>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      {/* Progress */}
      <div>
        <ProfileProgressBar pct={pct} />
      </div>

      {/* Employee-filled data summary */}
      {(status === 'PENDING_APPROVAL' || status === 'APPROVED') && (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          {[
            { section: 'Personal', items: personalItems },
            { section: 'Contact',  items: contactItems  },
            { section: 'KYC',      items: kycItems       },
          ].map(({ section, items }) => (
            <div key={section}>
              <p className="mb-1.5 text-xs font-medium text-gray-900">{section}</p>
              <div className="space-y-1">
                {items.map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    {value
                      ? <span className="max-w-[160px] truncate text-right text-xs font-medium text-gray-900">{value}</span>
                      : <span className="text-xs text-gray-300">—</span>
                    }
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* HR notes (existing) */}
      {emp.hrNotes && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <span className="font-medium">HR note: </span>{emp.hrNotes}
        </div>
      )}

      {/* HR actions */}
      {status === 'PENDING_APPROVAL' && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <Button variant="link" size="xs" onClick={() => setShowNotes(v => !v)} className="text-muted-foreground">
            {showNotes ? 'Hide notes' : 'Add notes'}
          </Button>

          {showNotes && (
            <Textarea
              rows={2}
              placeholder="Optional note for the employee"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="min-h-0 resize-none"
            />
          )}

          <div className="flex gap-2">
            <Button className="flex-1" disabled={approving} onClick={() => handleAction('approve')}>
              {approving ? <Loader2 className="animate-spin" /> : <ThumbsUp />}
              Approve
            </Button>
            <Button variant="outline" className="flex-1 text-red-600 hover:bg-red-50 hover:text-red-700" disabled={approving}
              onClick={() => handleAction('reject')}>
              <ThumbsDown />
              Return
            </Button>
          </div>
        </div>
      )}

      {status === 'APPROVED' && (
        <div className="flex items-center gap-2 text-xs text-emerald-700">
          <BadgeCheck className="size-4" />
          Approved — full access granted
        </div>
      )}

      {status !== 'PENDING_APPROVAL' && status !== 'APPROVED' && pct < 100 && (
        <p className="text-xs text-muted-foreground">Approval opens once the profile is 100% complete.</p>
      )}
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeProfilePage() {
  const { id } = useParams()
  const router  = useRouter()
  const { data: session } = useSession()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('overview')

  const isHR = ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role)
  const { canAny } = usePermission()
  // Salary figures are visible to whoever works with salaries (same rule as the API).
  const canSalary = canAny(['hr.salary.revise', 'hr.salary.approve', 'pii.financial.view', 'finance.salary.pay'])

  useEffect(() => {
    fetch(`/api/employees/${id}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) { toast.error(j.error); router.push('/admin/employees') }
        else setData(j.data)
      })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false))
  }, [id, router])

  // After a salary change: the salary / designation shown in the header follow.
  function reloadEmployee() {
    fetch(`/api/employees/${id}`).then(r => r.json()).then(j => { if (j.data) setData(j.data) }).catch(() => {})
  }

  if (loading) return <PageLoader />

  if (!data) return null

  const emp    = data
  const user   = emp.userId ?? {}
  const tasks  = emp.tasks ?? []
  const leaves = emp.leaves ?? []
  const attend = emp.attendance ?? []

  const TABS = [
    { id: 'overview',      label: 'Overview'   },
    ...(canSalary ? [{ id: 'salary', label: 'Salary' }] : []),
    { id: 'documents',     label: 'Documents'  },
    { id: 'assets',        label: 'Assets'     },
    { id: 'company-items', label: 'Company items' },
    { id: 'tasks',         label: 'Tasks',  count: tasks.length },
    { id: 'attendance',    label: 'Attendance' },
    { id: 'leaves',        label: 'Leaves', count: leaves.length },
  ]

  const subtitle = [emp.designation || emp.position, emp.department].filter(Boolean).join(' · ') || '—'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/admin/employees" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900">
          <ArrowLeft className="size-3.5" /> Employees
        </Link>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={user.name} src={user.avatar} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-900">{user.name ?? '—'}</h1>
              <RoleBadge role={user.role} />
              {user.isActive === false && <Badge variant="danger">Inactive</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-gray-600">
              {user.email && (
                <a href={`mailto:${user.email}`} className="inline-flex items-center gap-1.5 hover:text-gray-900 hover:underline underline-offset-4">
                  <Mail className="size-3.5 text-gray-400" /> {user.email}
                </a>
              )}
              {user.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-gray-400" /> {user.phone}
                </span>
              )}
              {emp.hireDate && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-gray-400" /> Joined {fmtDate(emp.hireDate)}
                </span>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex shrink-0 gap-6">
            <div>
              <p className="text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{emp.completionRate ?? 0}%</p>
              <p className="text-xs text-muted-foreground">Completion</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{emp.totalTasks ?? 0}</p>
              <p className="text-xs text-muted-foreground">Tasks</p>
            </div>
          </div>
        </div>
      </div>

      {/* Resigned banner */}
      {emp.resigned && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm text-orange-800">
          <LogOut className="size-4 shrink-0" />
          <span className="font-medium">Resigned</span>
          {emp.resignDate && <span className="text-xs">· {fmtDate(emp.resignDate)}</span>}
          <span className="text-xs sm:ml-auto">Read-only, kept for records</span>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(t => ({ value: t.id, label: t.label, count: t.count }))}
      />

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left: details */}
          <div className="space-y-6 lg:col-span-2">
            <Card className="p-5">
              <CardTitle className="mb-4">Personal</CardTitle>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <InfoRow label="Full name"   value={user.name} />
                <InfoRow label="Email"       value={user.email} />
                <InfoRow label="Phone"       value={user.phone} />
                <InfoRow label="Blood group" value={emp.bloodGroup} />
                {(emp.emergencyContacts ?? []).map((c, i) => (
                  <InfoRow key={i}
                    label={i === 0 ? 'Emergency contact' : `Emergency contact ${i + 1}`}
                    value={c.name ? `${c.name} (${c.relation}) · ${c.phone}` : null} />
                ))}
                <InfoRow label="NID number"  value={emp.nidNumber} />
                <InfoRow label="e-TIN"       value={emp.tin} />
                <InfoRow label="Address"     value={emp.address} className="sm:col-span-2" />
              </dl>
            </Card>

            <Card className="p-5">
              <CardTitle className="mb-4">Employment</CardTitle>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <InfoRow label="Employee ID"    value={emp.employeeId} />
                <InfoRow label="Department"     value={emp.department} />
                <InfoRow label="Position"       value={emp.position} />
                <InfoRow label="Designation"    value={emp.designation} />
                <InfoRow label="Monthly salary" value={<TkAmt value={emp.salary} />} />
                <InfoRow label="Hire date"      value={fmtDate(emp.hireDate)} />
                {emp.resigned && emp.resignDate && (
                  <InfoRow label="Resigned on" value={fmtDate(emp.resignDate)} />
                )}
              </dl>
            </Card>
          </div>

          {/* Right: sidebar */}
          <div className="space-y-6">
            {/* HR Profile Review card */}
            {isHR && <ProfileReviewCard emp={emp} empId={id} onUpdated={setData} />}

            <Card className="p-5">
              <CardTitle className="mb-4">Access &amp; role</CardTitle>
              <dl className="space-y-4">
                <div>
                  <dt className="mb-1 text-[13px] text-muted-foreground">Role</dt>
                  <dd><RoleBadge role={user.role} /></dd>
                </div>
                <div>
                  <dt className="mb-1 text-[13px] text-muted-foreground">Panel access</dt>
                  <dd>
                    {emp.panelAccessGranted
                      ? <Badge variant="success" dot>Granted</Badge>
                      : <Badge variant="default" dot>Not granted</Badge>}
                  </dd>
                </div>
                {user.lastLogin && (
                  <InfoRow label="Last login" value={fmtDate(user.lastLogin)} />
                )}
              </dl>
            </Card>

            {(emp.appointmentLetterUrl || emp.agreementUrl) && (
              <Card className="space-y-3 p-5">
                <CardTitle>Documents</CardTitle>
                {emp.appointmentLetterUrl && (
                  <a href={emp.appointmentLetterUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-medium text-gray-900 underline-offset-4 hover:underline">
                    <FileText className="size-4 text-gray-400" /> Appointment letter
                  </a>
                )}
                {emp.agreementUrl && (
                  <a href={emp.agreementUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-medium text-gray-900 underline-offset-4 hover:underline">
                    <Download className="size-4 text-gray-400" /> Agreement
                  </a>
                )}
              </Card>
            )}

            {(emp.companyItems ?? []).length > 0 && (
              <Card className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <CardTitle>Company items</CardTitle>
                  <span className="text-xs text-muted-foreground tabular-nums">{emp.companyItems.length}</span>
                </div>
                <div className="space-y-2">
                  {emp.companyItems.slice(0, 4).map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Package className="size-4 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-gray-900">{it.item}</p>
                        {it.value && <p className="truncate text-xs text-muted-foreground">{it.value}</p>}
                      </div>
                    </div>
                  ))}
                  {emp.companyItems.length > 4 && (
                    <Button variant="link" size="xs" onClick={() => setTab('company-items')} className="text-muted-foreground">
                      +{emp.companyItems.length - 4} more
                    </Button>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Documents Tab */}
      {tab === 'salary' && canSalary && (
        <EmployeeSalaryTab emp={emp} onChanged={reloadEmployee} />
      )}

      {tab === 'documents' && (
        <DocumentsTab emp={emp} empId={id} onUpdated={setData} />
      )}

      {/* Assets Tab (inventory register) */}
      {tab === 'assets' && (
        <AssetsTab empId={id} empName={user.name ?? null} />
      )}

      {/* Company Items Tab (legacy free-text list) */}
      {tab === 'company-items' && (
        <CompanyItemsTab emp={emp} empId={id} onUpdated={setData} onGoToAssets={() => setTab('assets')} />
      )}

      {/* Tasks Tab */}
      {tab === 'tasks' && (
        <Card className="overflow-hidden">
          {tasks.length === 0 ? (
            <EmptyState title="No tasks yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map(t => {
                  const sm = TASK_STATUS_META[t.status] ?? { label: t.status, variant: 'default' }
                  return (
                    <TableRow key={t._id}>
                      <TableCell className="text-gray-900">{t.title ?? '—'}</TableCell>
                      <TableCell className="text-gray-500">{t.projectId?.name ?? '—'}</TableCell>
                      <TableCell><Badge variant={sm.variant}>{sm.label}</Badge></TableCell>
                      <TableCell className="text-gray-500 tabular-nums">{fmtDate(t.dueDate)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* Attendance Tab */}
      {tab === 'attendance' && (
        <Card className="overflow-hidden">
          {attend.length === 0 ? (
            <EmptyState title="No attendance yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Check in</TableHead>
                  <TableHead>Check out</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attend.map(a => (
                  <TableRow key={a._id}>
                    <TableCell className="text-gray-900 tabular-nums">{fmtDate(a.date)}</TableCell>
                    <TableCell className="tabular-nums">{a.checkIn ? new Date(a.checkIn).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                    <TableCell className="tabular-nums">{a.checkOut ? new Date(a.checkOut).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                    <TableCell>
                      {a.status === 'PRESENT' ? (
                        <Badge variant="success">Present</Badge>
                      ) : a.status === 'ABSENT' ? (
                        <Badge variant="danger">Absent</Badge>
                      ) : (
                        <Badge variant="warning">{a.status ? prettyEnum(a.status) : 'Unknown'}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* Leaves Tab */}
      {tab === 'leaves' && (
        <Card className="overflow-hidden">
          {leaves.length === 0 ? (
            <EmptyState title="No leaves yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaves.map(l => (
                  <TableRow key={l._id}>
                    <TableCell className="text-gray-900">{prettyEnum(l.type ?? l.leaveType)}</TableCell>
                    <TableCell className="tabular-nums">{fmtDate(l.startDate)}</TableCell>
                    <TableCell className="tabular-nums">{fmtDate(l.endDate)}</TableCell>
                    <TableCell className="max-w-xs truncate text-gray-500">{l.reason ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={l.status === 'APPROVED' ? 'success' : l.status === 'REJECTED' ? 'danger' : 'warning'}>
                        {prettyEnum(l.status ?? 'PENDING')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
