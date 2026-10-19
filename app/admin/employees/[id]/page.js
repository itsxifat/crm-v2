'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Briefcase, Shield,
  ShieldCheck, FileText, Download, CheckCircle2, Clock, XCircle,
  User, Building2, CreditCard, Activity, Upload, Loader2, X, Image,
  Package, Plus, Pencil, Save, BadgeCheck, AlertCircle, ThumbsUp, ThumbsDown, LogOut,
} from 'lucide-react'
import {
  Printer, Undo2, TriangleAlert, RefreshCw, Boxes, History, PackageCheck, CircleCheckBig, Flag,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import Avatar from '@/components/ui/Avatar'
import TkAmt from '@/components/ui/TkAmt'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import AssetPicker from '@/components/inventory/AssetPicker'
import AssetStatusBadge, { AssetConditionBadge, InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import {
  ACK_META, RECOVERY_STATUS_META, RECOVERY_METHOD_LABELS, DAMAGE_CAUSE_LABELS, CONDITION_OPTIONS,
} from '@/lib/inventory/constants'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const fmtMoney = (n) => n != null ? `৳ ${Number(n).toLocaleString('en-BD')}` : '—'

const ROLE_META = {
  SUPER_ADMIN: { label: 'Super Admin', bg: 'bg-red-50',     text: 'text-red-700'    },
  MANAGER:     { label: 'Manager',     bg: 'bg-blue-50',    text: 'text-blue-700'   },
  EMPLOYEE:    { label: 'Employee',    bg: 'bg-gray-100',   text: 'text-gray-600'   },
  FREELANCER:  { label: 'Freelancer',  bg: 'bg-purple-50',  text: 'text-purple-700' },
  CLIENT:      { label: 'Client',      bg: 'bg-green-50',   text: 'text-green-700'  },
  VENDOR:      { label: 'Vendor',      bg: 'bg-orange-50',  text: 'text-orange-700' },
}

const TASK_STATUS_META = {
  TODO:        { label: 'To Do',       color: 'text-gray-500',  bg: 'bg-gray-100'   },
  IN_PROGRESS: { label: 'In Progress', color: 'text-blue-600',  bg: 'bg-blue-50'    },
  IN_REVIEW:   { label: 'In Review',   color: 'text-yellow-600',bg: 'bg-yellow-50'  },
  COMPLETED:   { label: 'Completed',   color: 'text-green-600', bg: 'bg-green-50'   },
  CANCELLED:   { label: 'Cancelled',   color: 'text-red-500',   bg: 'bg-red-50'     },
}

function RoleBadge({ role }) {
  const m = ROLE_META[role] ?? { label: role, bg: 'bg-gray-100', text: 'text-gray-500' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm text-gray-800">{value}</p>
      </div>
    </div>
  )
}

const DOC_TYPE_META = {
  NID:               { label: 'National ID (NID)',      color: 'text-blue-700',   bg: 'bg-blue-50'   },
  BIRTH_CERTIFICATE: { label: 'Birth Certificate',      color: 'text-teal-700',   bg: 'bg-teal-50'   },
  CV:                { label: 'CV / Resume',             color: 'text-purple-700', bg: 'bg-purple-50' },
  PASSPORT:          { label: 'Passport',                color: 'text-orange-700', bg: 'bg-orange-50' },
  ACADEMIC:          { label: 'Academic Certificate',    color: 'text-green-700',  bg: 'bg-green-50'  },
  APPOINTMENT:       { label: 'Appointment Letter',      color: 'text-indigo-700', bg: 'bg-indigo-50' },
  AGREEMENT:         { label: 'Agreement / Contract',    color: 'text-pink-700',   bg: 'bg-pink-50'   },
  PHOTO:             { label: 'Formal Photo',            color: 'text-yellow-700', bg: 'bg-yellow-50' },
  OTHER:             { label: 'Other',                   color: 'text-gray-600',   bg: 'bg-gray-100'  },
}
const DOC_TYPES = Object.keys(DOC_TYPE_META)

function isImage(url) { return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url) }

function DocCard({ doc, onRemove }) {
  const meta = DOC_TYPE_META[doc.type] ?? DOC_TYPE_META.OTHER
  const name = doc.name || doc.url?.split('/').pop() || 'Document'
  return (
    <div className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-sm transition-all group">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
        {isImage(doc.url) ? <Image alt="" className={`w-4 h-4 ${meta.color}`} /> : <FileText className={`w-4 h-4 ${meta.color}`} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
        <span className={`inline-block text-xs px-1.5 py-0.5 rounded-full mt-0.5 ${meta.bg} ${meta.color}`}>{meta.label}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <a href={doc.url} target="_blank" rel="noreferrer"
          className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
          <Download className="w-4 h-4" />
        </a>
        {onRemove && (
          <button type="button" onClick={onRemove}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
            <X className="w-4 h-4" />
          </button>
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
    emp.photo            && { url: emp.photo,            type: 'PHOTO',       name: 'Formal Photo',        _system: true },
    emp.appointmentLetterUrl && { url: emp.appointmentLetterUrl, type: 'APPOINTMENT', name: 'Appointment Letter', _system: true },
    emp.agreementUrl     && { url: emp.agreementUrl,     type: 'AGREEMENT',   name: 'Agreement / Contract', _system: true },
    ...( emp.documents ?? []).map(d => ({ ...d, _system: false })),
  ].filter(Boolean)

  async function handleUpload(file) {
    if (!file) return
    if (addType === 'OTHER' && !addName.trim()) {
      toast.error('Please enter a document name for "Other" type')
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
    <div className="space-y-5">
      {/* Existing docs */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          All Documents
          <span className="ml-2 text-xs font-normal text-gray-400">({systemDocs.length} file{systemDocs.length !== 1 ? 's' : ''})</span>
        </h3>
        {systemDocs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-xl">No documents uploaded yet</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {systemDocs.map((doc, i) => (
              <DocCard key={i} doc={doc}
                onRemove={doc._system ? null : () => handleRemove(
                  (emp.documents ?? []).findIndex((d, di) => d.url === doc.url && di === i - systemDocs.filter(s => s._system).length)
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upload new */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Upload Document</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Document Type</label>
            <select value={addType} onChange={e => { setAddType(e.target.value); setAddName('') }}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_META[t].label}</option>)}
            </select>
          </div>
          {addType === 'OTHER' && (
            <div className="min-w-[180px]">
              <label className="block text-xs text-gray-400 mb-1">Document Name <span className="text-red-400">*</span></label>
              <input value={addName} onChange={e => setAddName(e.target.value)}
                placeholder="e.g. Medical Certificate"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-gray-400 mb-1">File</label>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Choose file'}
            </button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={e => handleUpload(e.target.files?.[0])} />
          </div>
        </div>

        {/* Staged new docs */}
        {newDocs.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-gray-400">Ready to save ({newDocs.length} new):</p>
            {newDocs.map((doc, i) => (
              <DocCard key={i} doc={doc} onRemove={() => setNewDocs(d => d.filter((_, j) => j !== i))} />
            ))}
            <button onClick={handleSave} disabled={saving}
              className="mt-2 flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Save Documents
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Assets (inventory register) ─────────────────────────────────────────────

const assetInput = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const assetLabel = 'block text-xs font-medium text-gray-600 mb-1'
const assetBtnPrimary = 'inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50'
const assetBtnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'

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
    <Modal open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="md" title="Assign an asset"
      description={empName ? `Issue equipment from stock to ${empName}` : undefined}>
      <form id="assign-asset-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className={assetLabel}>Asset in stock <span className="text-red-500">*</span></label>
          <AssetPicker value={assetId} onChange={(id) => setAssetId(id)} statuses={['IN_STOCK']} placeholder="Search by tag, name or serial…" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={assetLabel}>Expected return (optional)</label>
            <DatePicker value={expectedReturnDate} onChange={setExpectedReturnDate} placeholder="No return date" />
          </div>
          <div>
            <label className={assetLabel}>Condition at handover</label>
            <select value={condition} onChange={e => setCondition(e.target.value)} className={assetInput}>
              <option value="">As recorded</option>
              {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={assetLabel}>Notes (optional)</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} className={assetInput}
            placeholder="e.g. With charger and laptop bag" />
        </div>
        <p className="text-xs text-gray-400">
          If the category needs it, the employee is asked to acknowledge receipt in My Assets.
        </p>
      </form>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" form="assign-asset-form" disabled={saving || !assetId} className={assetBtnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Assign
        </button>
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
            <label className={assetLabel}>Condition on return</label>
            <select value={condition} onChange={e => setCondition(e.target.value)} className={assetInput}>
              {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {condition === 'BROKEN' && <p className="text-xs text-orange-600 mt-1">A broken item is recorded as damaged, awaiting a decision.</p>}
          </div>
          <div>
            <label className={assetLabel}>Notes (optional)</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} className={assetInput}
              placeholder="e.g. Returned on exit, charger missing" />
          </div>
        </form>
      )}
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" form="return-asset-form" disabled={saving} className={assetBtnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Return
        </button>
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
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  }
  if (error && !data) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-gray-700">{error}</p>
        <button type="button" onClick={load} className={`${assetBtnPrimary} mt-4`}><RefreshCw className="w-4 h-4" /> Try again</button>
      </div>
    )
  }
  if (!data) return null

  const { assets = [], damageCases = [], consumables, returned = [], summary = {}, canViewFinancials } = data
  const pending  = assets.filter(a => a.acknowledgement?.status === 'PENDING')
  const declined = assets.filter(a => a.acknowledgement?.status === 'DECLINED')
  const tagCell = (a) => canOpenAsset
    ? <Link href={`/admin/inventory/assets/${a.id}`} className="font-mono text-xs text-blue-600 hover:underline">{a.assetTag}</Link>
    : <span className="font-mono text-xs text-gray-500">{a.assetTag}</span>
  const th = 'px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap'

  return (
    <div className="space-y-5">
      {/* Summary & actions */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 text-xs text-gray-700">
            <Package className="w-3.5 h-3.5 text-gray-400" /> {summary.held ?? 0} held
          </span>
          {summary.pendingAcknowledgement > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-xs text-amber-700">{summary.pendingAcknowledgement} awaiting acknowledgement</span>
          )}
          {summary.declined > 0 && <span className="px-2.5 py-1 rounded-lg bg-red-50 text-xs text-red-700">{summary.declined} declined</span>}
          {summary.overdueReturns > 0 && <span className="px-2.5 py-1 rounded-lg bg-red-50 text-xs text-red-700">{summary.overdueReturns} overdue return</span>}
          {summary.openDamageCases > 0 && <span className="px-2.5 py-1 rounded-lg bg-orange-50 text-xs text-orange-700">{summary.openDamageCases} recovery pending{canViewFinancials && summary.recoveryOutstanding > 0 ? <> · <TkAmt value={summary.recoveryOutstanding} /></> : null}</span>}
          {summary.awaitingAssessment > 0 && <span className="px-2.5 py-1 rounded-lg bg-orange-50 text-xs text-orange-700">{summary.awaitingAssessment} reported problem{summary.awaitingAssessment === 1 ? '' : 's'}</span>}
          {canViewFinancials && summary.heldCost > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-gray-50 text-xs text-gray-700">Book value <TkAmt value={summary.heldBookValue} /></span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <button type="button" onClick={load} disabled={loading} className={assetBtnGhost} aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {assets.length > 0 && (
            <a href={`/api/employees/${empId}/assets/handover`} target="_blank" rel="noreferrer" className={assetBtnGhost}>
              <Printer className="w-3.5 h-3.5" /> Handover form
            </a>
          )}
          {canAssign && (
            <button type="button" onClick={() => setAssignOpen(true)}
              className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-3 py-1.5 text-xs font-medium">
              <Plus className="w-3.5 h-3.5" /> Assign asset
            </button>
          )}
        </div>
      </div>

      {/* Exit clearance */}
      <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${summary.clearance?.clear ? 'bg-green-50 border-green-100 text-green-800' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
        {summary.clearance?.clear ? <CircleCheckBig className="w-4 h-4 mt-0.5 shrink-0" /> : <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />}
        <div>
          <p className="font-medium">{summary.clearance?.clear ? 'Clear for exit — nothing is outstanding' : 'Not clear for exit yet'}</p>
          {!summary.clearance?.clear && <p className="text-xs mt-0.5">{(summary.clearance?.reasons ?? []).join(' · ')}</p>}
        </div>
      </div>

      {(pending.length > 0 || declined.length > 0) && (
        <div className="bg-white border border-amber-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-2"><PackageCheck className="w-4 h-4 text-amber-500" /> Acknowledgements</p>
          {pending.map(a => (
            <p key={a.id} className="text-xs text-gray-600">
              {tagCell(a)} <span className="ml-1">{a.name}</span> — waiting since {fmtDate(a.assignedAt)}
            </p>
          ))}
          {declined.map(a => (
            <p key={a.id} className="text-xs text-red-700">
              {tagCell(a)} <span className="ml-1">{a.name}</span> — declined {fmtDate(a.acknowledgement?.at)}{a.acknowledgement?.note ? `: “${a.acknowledgement.note}”` : ''}
            </p>
          ))}
        </div>
      )}

      {/* Held assets */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Assigned equipment</h3>
        </div>
        {assets.length === 0 ? (
          <div className="text-center py-10">
            <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No assets are assigned to {empName ?? 'this employee'}</p>
            {canAssign && <button type="button" onClick={() => setAssignOpen(true)} className="mt-2 text-sm text-blue-600 hover:underline">Assign one from stock</button>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className={th}>Asset</th>
                  <th className={th}>Status</th>
                  <th className={th}>Condition</th>
                  <th className={th}>Acknowledgement</th>
                  <th className={th}>Issued</th>
                  {canViewFinancials && <th className={`${th} text-right`}>Book value</th>}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {assets.map(a => {
                  const ack = a.acknowledgement?.status ?? 'NOT_REQUIRED'
                  return (
                    <tr key={a.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3">
                        {tagCell(a)}
                        <p className="text-sm text-gray-900">{a.name}</p>
                        <p className="text-xs text-gray-400">{[a.category?.name, [a.brand, a.model].filter(Boolean).join(' '), a.serialNumber ? `S/N ${a.serialNumber}` : null].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="px-4 py-3"><AssetStatusBadge status={a.status} /></td>
                      <td className="px-4 py-3"><AssetConditionBadge condition={a.condition} /></td>
                      <td className="px-4 py-3">
                        {ack === 'NOT_REQUIRED'
                          ? <span className="text-xs text-gray-400">Not required</span>
                          : <InventoryBadge label={ACK_META[ack]?.label ?? ack} color={ACK_META[ack]?.color ?? 'gray'} />}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <p className="text-gray-700">{fmtDate(a.assignedAt)}</p>
                        {a.expectedReturnDate && (
                          <p className={a.overdue ? 'text-red-600 font-medium' : 'text-gray-400'}>Return by {fmtDate(a.expectedReturnDate)}</p>
                        )}
                      </td>
                      {canViewFinancials && (
                        <td className="px-4 py-3 text-right text-sm text-gray-700 whitespace-nowrap"><TkAmt value={a.bookValue} /></td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <a href={`/api/my-assets/${a.id}/handover`} target="_blank" rel="noreferrer" title="Print handover form"
                            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50" aria-label={`Print handover form for ${a.assetTag}`}>
                            <Printer className="w-4 h-4" />
                          </a>
                          {canAssign && a.status === 'ASSIGNED' && (
                            <button type="button" onClick={() => setReturnTarget(a)} className={assetBtnGhost}>
                              <Undo2 className="w-3.5 h-3.5" /> Return
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Damage / loss cases */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Damage &amp; loss cases</h3>
          <p className="text-xs text-gray-400">Recovery from pay is only for loss directly caused by neglect, after an enquiry (Labour Act 2006 s.125/127).</p>
        </div>
        {damageCases.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">No damage or loss has been recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className={th}>Date</th>
                  <th className={th}>Asset</th>
                  <th className={th}>What happened</th>
                  <th className={th}>Liability</th>
                  <th className={th}>Recovery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {damageCases.map(c => {
                  const rec = c.recovery
                  const recMeta = rec?.status ? RECOVERY_STATUS_META[rec.status] : null
                  return (
                    <tr key={c.id} className="align-top">
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtDate(c.date)}</td>
                      <td className="px-4 py-3">
                        {c.asset ? (canOpenAsset
                          ? <Link href={`/admin/inventory/assets/${c.asset.id}`} className="font-mono text-xs text-blue-600 hover:underline">{c.asset.assetTag}</Link>
                          : <span className="font-mono text-xs text-gray-500">{c.asset.assetTag}</span>) : '—'}
                        <p className="text-xs text-gray-500">{c.asset?.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm text-gray-800">{CASE_TYPE_LABEL(c)}</span>
                          {c.cause && c.cause !== 'UNKNOWN' && <span className="text-xs text-gray-500">· {DAMAGE_CAUSE_LABELS[c.cause] ?? c.cause}</span>}
                          {c.reportedByEmployee && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"><Flag className="w-3 h-3" /> Self-reported</span>
                          )}
                          {c.awaitingAssessment && <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">Awaiting assessment</span>}
                        </div>
                        {c.description && <p className="text-xs text-gray-500 mt-0.5 max-w-sm">{c.description}</p>}
                        {c.gdNumber && <p className="text-xs text-gray-400 mt-0.5">GD no. {c.gdNumber}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {c.isResponsible ? <p className="text-gray-800">Held responsible{c.liabilityPct != null ? ` (${c.liabilityPct}%)` : ''}</p> : <p className="text-gray-400">—</p>}
                        {canViewFinancials && c.assessedLoss != null && <p>Loss <TkAmt value={c.assessedLoss} /></p>}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {rec ? (
                          <div className="space-y-1">
                            {recMeta && <InventoryBadge label={recMeta.label} color={recMeta.color} />}
                            <p className="text-gray-500">
                              {RECOVERY_METHOD_LABELS[rec.method] ?? rec.method ?? ''}
                              {canViewFinancials && rec.amount != null ? <> · <TkAmt value={rec.amount} /></> : null}
                            </p>
                            {canViewFinancials && Number(rec.recoveredAmount) > 0 && rec.status !== 'RECOVERED' && (
                              <p className="text-gray-500">
                                Recovered <TkAmt value={rec.recoveredAmount} />
                                {rec.status === 'PENDING' && Number(rec.outstanding) > 0 ? <> · balance <TkAmt value={rec.outstanding} /></> : null}
                              </p>
                            )}
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Consumables */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Boxes className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-700">Supplies issued</h3>
          {canViewFinancials && consumables?.totals?.value > 0 && (
            <span className="ml-auto text-xs text-gray-500">Value <TkAmt value={consumables.totals.value} /></span>
          )}
        </div>
        {(consumables?.items ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">No consumables have been issued to this employee.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className={th}>Item</th>
                  <th className={`${th} text-right`}>Issued</th>
                  <th className={`${th} text-right`}>Returned</th>
                  <th className={th}>Last issued</th>
                  {canViewFinancials && <th className={`${th} text-right`}>Value</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {consumables.items.map((i, idx) => (
                  <tr key={i.stockItem?.id ?? idx}>
                    <td className="px-4 py-2.5">
                      <p className="text-gray-900">{i.stockItem?.name ?? '—'}</p>
                      {i.stockItem?.sku && <p className="text-xs text-gray-400 font-mono">{i.stockItem.sku}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">{i.issued} {i.stockItem?.unit ?? ''}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-gray-500">{i.returned || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(i.lastIssuedAt)}</td>
                    {canViewFinancials && <td className="px-4 py-2.5 text-right whitespace-nowrap"><TkAmt value={i.value} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Returned history */}
      {returned.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-700">Previously returned</h3>
          </div>
          <ul className="divide-y divide-gray-50">
            {returned.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                {r.asset ? (canOpenAsset
                  ? <Link href={`/admin/inventory/assets/${r.asset.id}`} className="font-mono text-xs text-blue-600 hover:underline">{r.asset.assetTag}</Link>
                  : <span className="font-mono text-xs text-gray-500">{r.asset.assetTag}</span>) : null}
                <span className="text-gray-800">{r.asset?.name ?? '—'}</span>
                {r.condition && <AssetConditionBadge condition={r.condition} />}
                <span className="text-xs text-gray-400 sm:ml-auto">{fmtDate(r.date)}{r.by ? ` · ${r.by}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AssignAssetModal open={assignOpen} empId={empId} empName={empName} onClose={() => setAssignOpen(false)}
        onDone={() => { setAssignOpen(false); load() }} />
      <ReturnAssetModal asset={returnTarget} onClose={() => setReturnTarget(null)}
        onDone={() => { setReturnTarget(null); load() }} />
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-[220px] text-sm text-amber-900">
          <p className="font-medium">Company items is legacy — use Assets</p>
          <p className="text-xs text-amber-800 mt-0.5">
            Issue new equipment from the Assets tab so it gets a tag, a history and the employee&apos;s acknowledgement.
            An administrator can convert these entries into assets with <code className="font-mono">npm run db:migrate-company-items</code>.
          </p>
        </div>
        {onGoToAssets && (
          <button type="button" onClick={onGoToAssets}
            className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-3 py-1.5 text-xs font-medium">
            <Package className="w-3.5 h-3.5" /> Go to Assets
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Company Provided Items</h3>
            <p className="text-xs text-gray-400 mt-0.5">Assets and equipment issued to this employee</p>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Item
          </button>
        </div>

        {/* Add form */}
        {adding && (
          <div className="mb-4 p-4 border border-blue-100 bg-blue-50/40 rounded-xl space-y-3">
            <p className="text-xs font-semibold text-blue-700">New Item</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Item Name <span className="text-red-400">*</span></label>
                <input list="item-presets" value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
                  placeholder="e.g. Laptop" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <datalist id="item-presets">
                  {itemPresets.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Serial / Model / Value</label>
                <input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="e.g. ThinkPad X1 / SN-2345" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Note</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional note" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={commitAdd}
                className="px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                Add
              </button>
              <button onClick={cancelForm} className="px-4 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Items list */}
        {items.length === 0 && !adding ? (
          <div className="text-center py-10 border border-dashed border-gray-200 rounded-xl">
            <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No items issued yet</p>
            <p className="text-xs text-gray-300 mt-0.5">Click "Add Item" to record company-provided assets</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it._id}>
                {editIdx === i ? (
                  <div className="p-4 border border-indigo-100 bg-indigo-50/30 rounded-xl space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Item Name <span className="text-red-400">*</span></label>
                        <input list="item-presets" value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Serial / Model / Value</label>
                        <input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Note</label>
                        <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={commitEdit}
                        className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors">
                        Save
                      </button>
                      <button onClick={cancelForm} className="px-4 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white group transition-all">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{it.item}</p>
                      {it.value && <p className="text-xs text-gray-500 mt-0.5">{it.value}</p>}
                      {it.description && <p className="text-xs text-gray-400 italic mt-0.5">{it.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(i)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeItem(i)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Save button */}
        {isDirty && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Profile Status / Review Card ────────────────────────────────────────────

const PROFILE_STATUS_META = {
  CREATED:          { label: 'Not Started',       bg: 'bg-gray-100',   text: 'text-gray-600',  icon: AlertCircle },
  INCOMPLETE:       { label: 'Incomplete',         bg: 'bg-amber-50',   text: 'text-amber-700', icon: AlertCircle },
  PENDING_APPROVAL: { label: 'Pending HR Review',  bg: 'bg-blue-50',    text: 'text-blue-700',  icon: Clock       },
  APPROVED:         { label: 'Approved',           bg: 'bg-green-50',   text: 'text-green-700', icon: BadgeCheck  },
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

  const color = display === 100 ? 'bg-green-500' : display >= 60 ? 'bg-blue-500' : 'bg-amber-400'
  return (
    <>
      <div className="flex items-center justify-between mb-1.5 text-xs">
        <span className="text-gray-500">Completion</span>
        <span className={`font-bold transition-colors ${display === 100 ? 'text-green-600' : 'text-blue-600'}`}>{display}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${display}%` }} />
      </div>
    </>
  )
}

function ProfileReviewCard({ emp, empId, onUpdated }) {
  const pct    = emp.profileCompletionPct ?? 0
  const status = emp.profileStatus ?? 'CREATED'
  const meta   = PROFILE_STATUS_META[status] ?? PROFILE_STATUS_META.INCOMPLETE
  const Icon   = meta.icon

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
    { label: 'Date of Birth',  value: emp.dateOfBirth ? new Date(emp.dateOfBirth).toLocaleDateString('en-GB') : null },
    { label: 'Nationality',    value: emp.nationality },
    { label: 'Marital Status', value: emp.maritalStatus },
    { label: 'Photo',          value: emp.photo ? '✓ Uploaded' : null },
  ]
  const contactItems = [
    { label: 'Phone',             value: emp.phone },
    { label: 'Alt Phone',         value: emp.secondaryPhone },
    { label: 'Address',           value: emp.address },
    ...(emp.emergencyContacts ?? []).map((c, i) => ({
      label: i === 0 ? 'Emergency Contact' : `Emergency Contact ${i + 1}`,
      value: c.name ? `${c.name} (${c.relation}) · ${c.phone}` : null,
    })),
  ]
  const kycItems = [
    { label: 'NID Number',      value: emp.nidNumber },
    { label: 'Passport Number', value: emp.passportNumber },
    { label: 'Documents',       value: (emp.documents ?? []).length > 0 ? `${emp.documents.length} file(s)` : null },
  ]

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Profile Onboarding</h3>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${meta.bg} ${meta.text}`}>
          <Icon className="w-3.5 h-3.5" />
          {meta.label}
        </span>
      </div>

      {/* Progress */}
      <div>
        <ProfileProgressBar pct={pct} />
      </div>

      {/* Employee-filled data summary */}
      {(status === 'PENDING_APPROVAL' || status === 'APPROVED') && (
        <div className="space-y-3 pt-1">
          {[
            { section: 'Personal', items: personalItems },
            { section: 'Contact',  items: contactItems  },
            { section: 'KYC',      items: kycItems       },
          ].map(({ section, items }) => (
            <div key={section}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{section}</p>
              <div className="space-y-1">
                {items.map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{label}</span>
                    {value
                      ? <span className="text-xs text-gray-800 font-medium max-w-[160px] truncate text-right">{value}</span>
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
        <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
          <span className="font-medium">HR Note: </span>{emp.hrNotes}
        </div>
      )}

      {/* HR actions */}
      {status === 'PENDING_APPROVAL' && (
        <div className="pt-1 space-y-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowNotes(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            {showNotes ? 'Hide notes' : 'Add notes (optional)'}
          </button>

          {showNotes && (
            <textarea
              rows={2}
              placeholder="Optional notes for the employee…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={approving}
              onClick={() => handleAction('approve')}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button
              type="button"
              disabled={approving}
              onClick={() => handleAction('reject')}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-50 text-red-700 text-xs font-semibold rounded-xl hover:bg-red-100 disabled:opacity-50 transition-colors border border-red-100"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
              Return
            </button>
          </div>
        </div>
      )}

      {status === 'APPROVED' && (
        <div className="flex items-center gap-2 pt-1 text-xs text-green-700">
          <BadgeCheck className="w-4 h-4" />
          Profile approved — full access granted
        </div>
      )}

      {status !== 'PENDING_APPROVAL' && status !== 'APPROVED' && pct < 100 && (
        <p className="text-xs text-gray-400 pt-1">Approval available after employee completes 100% of their profile.</p>
      )}
    </div>
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

  if (loading) return (
    <div className="flex justify-center py-32">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!data) return null

  const emp    = data
  const user   = emp.userId ?? {}
  const tasks  = emp.tasks ?? []
  const leaves = emp.leaves ?? []
  const attend = emp.attendance ?? []

  const docs = emp.documents ?? []

  const TABS = [
    { id: 'overview',      label: 'Overview'   },
    { id: 'documents',     label: 'Documents'  },
    { id: 'assets',        label: 'Assets'     },
    { id: 'company-items', label: 'Company Items' },
    { id: 'tasks',         label: `Tasks (${tasks.length})`  },
    { id: 'attendance',    label: 'Attendance' },
    { id: 'leaves',        label: `Leaves (${leaves.length})` },
  ]

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/admin/employees" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Employees
      </Link>

      {/* Resigned Banner */}
      {emp.resigned && (
        <div className="flex items-center gap-3 px-5 py-3.5 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-800">
          <LogOut className="w-4 h-4 shrink-0 text-orange-500" />
          <span className="font-medium">This employee has resigned</span>
          {emp.resignDate && (
            <span className="text-orange-600 text-xs">· {fmtDate(emp.resignDate)}</span>
          )}
          <span className="ml-auto text-xs text-orange-500">All data is read-only and preserved for records</span>
        </div>
      )}

      {/* Profile Header */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={user.name} src={user.avatar} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-semibold text-gray-900">{user.name ?? '—'}</h1>
              <RoleBadge role={user.role} />
              {user.isActive === false && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-600">Inactive</span>
              )}
            </div>
            <p className="text-sm text-gray-500">{emp.designation || emp.position || '—'}</p>
            {emp.department && <p className="text-xs text-gray-400 mt-0.5">{emp.department}</p>}

            <div className="flex flex-wrap gap-4 mt-4">
              {user.email && (
                <a href={`mailto:${user.email}`} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-600">
                  <Mail className="w-3.5 h-3.5" /> {user.email}
                </a>
              )}
              {user.phone && (
                <span className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Phone className="w-3.5 h-3.5" /> {user.phone}
                </span>
              )}
              {emp.hireDate && (
                <span className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Calendar className="w-3.5 h-3.5" /> Joined {fmtDate(emp.hireDate)}
                </span>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex gap-4 shrink-0">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{emp.completionRate ?? 0}%</p>
              <p className="text-xs text-gray-400">Completion</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{emp.totalTasks ?? 0}</p>
              <p className="text-xs text-gray-400">Tasks</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-full overflow-x-auto">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: details */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoRow icon={User}     label="Full Name"        value={user.name} />
                <InfoRow icon={Mail}     label="Email"            value={user.email} />
                <InfoRow icon={Phone}    label="Phone"            value={user.phone} />
                <InfoRow icon={Activity} label="Blood Group"      value={emp.bloodGroup} />
                {(emp.emergencyContacts ?? []).map((c, i) => (
                  <InfoRow key={i} icon={Phone}
                    label={i === 0 ? 'Emergency Contact' : `Emergency Contact ${i + 1}`}
                    value={c.name ? `${c.name} (${c.relation}) · ${c.phone}` : null} />
                ))}
                <InfoRow icon={CreditCard} label="NID Number"     value={emp.nidNumber} />
                <InfoRow icon={CreditCard} label="e-TIN"          value={emp.tin} />
                <InfoRow icon={MapPin}   label="Address"          value={emp.address} className="sm:col-span-2" />
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Employment Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoRow icon={Briefcase} label="Employee ID"     value={emp.employeeId} />
                <InfoRow icon={Building2} label="Department"      value={emp.department} />
                <InfoRow icon={Briefcase} label="Position"        value={emp.position} />
                <InfoRow icon={Briefcase} label="Designation"     value={emp.designation} />
                <InfoRow icon={CreditCard} label="Monthly Salary" value={<TkAmt value={emp.salary} />} />
                <InfoRow icon={Calendar}  label="Hire Date"       value={fmtDate(emp.hireDate)} />
                {emp.resigned && emp.resignDate && (
                  <InfoRow icon={LogOut} label="Resigned On" value={fmtDate(emp.resignDate)} />
                )}
              </div>
            </div>
          </div>

          {/* Right: sidebar */}
          <div className="space-y-5">
            {/* HR Profile Review card */}
            {isHR && <ProfileReviewCard emp={emp} empId={id} onUpdated={setData} />}

            <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Access & Role</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Role</p>
                  <RoleBadge role={user.role} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Panel Access</p>
                  {emp.panelAccessGranted ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                      <ShieldCheck className="w-3.5 h-3.5" /> Granted
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      <Shield className="w-3.5 h-3.5" /> Not granted
                    </span>
                  )}
                </div>
                {user.lastLogin && (
                  <InfoRow icon={Clock} label="Last Login" value={fmtDate(user.lastLogin)} />
                )}
              </div>
            </div>

            {(emp.appointmentLetterUrl || emp.agreementUrl) && (
              <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Documents</h3>
                {emp.appointmentLetterUrl && (
                  <a href={emp.appointmentLetterUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 text-sm text-blue-600 hover:text-blue-800 transition-colors">
                    <FileText className="w-4 h-4" /> Appointment Letter
                  </a>
                )}
                {emp.agreementUrl && (
                  <a href={emp.agreementUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 text-sm text-purple-600 hover:text-purple-800 transition-colors">
                    <Download className="w-4 h-4" /> Agreement
                  </a>
                )}
              </div>
            )}

            {(emp.companyItems ?? []).length > 0 && (
              <div className="bg-white border border-gray-100 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">Company Items</h3>
                  <span className="text-xs text-gray-400">{emp.companyItems.length} item{emp.companyItems.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-2">
                  {emp.companyItems.slice(0, 4).map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{it.item}</p>
                        {it.value && <p className="text-xs text-gray-400 truncate">{it.value}</p>}
                      </div>
                    </div>
                  ))}
                  {emp.companyItems.length > 4 && (
                    <button onClick={() => setTab('company-items')}
                      className="text-xs text-blue-500 hover:text-blue-700 mt-1">
                      +{emp.companyItems.length - 4} more — view all
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Documents Tab */}
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
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {tasks.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No tasks assigned</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Task</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Project</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tasks.map(t => {
                  const sm = TASK_STATUS_META[t.status] ?? { label: t.status, color: 'text-gray-500', bg: 'bg-gray-100' }
                  return (
                    <tr key={t._id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3 text-sm text-gray-800">{t.title ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{t.projectId?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sm.bg} ${sm.color}`}>
                          {sm.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(t.dueDate)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Attendance Tab */}
      {tab === 'attendance' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {attend.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No attendance records</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Check In</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Check Out</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {attend.map(a => (
                  <tr key={a._id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 text-sm text-gray-800">{fmtDate(a.date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{a.checkIn ? new Date(a.checkIn).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{a.checkOut ? new Date(a.checkOut).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-3">
                      {a.status === 'PRESENT' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3" /> Present
                        </span>
                      ) : a.status === 'ABSENT' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded">
                          <XCircle className="w-3 h-3" /> Absent
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">
                          <Clock className="w-3 h-3" /> {a.status ?? 'Unknown'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Leaves Tab */}
      {tab === 'leaves' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {leaves.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No leave records</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">From</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">To</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leaves.map(l => (
                  <tr key={l._id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 text-sm text-gray-800">{l.type ?? l.leaveType ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(l.startDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(l.endDate)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{l.reason ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        l.status === 'APPROVED' ? 'bg-green-50 text-green-700' :
                        l.status === 'REJECTED' ? 'bg-red-50 text-red-600' :
                        'bg-yellow-50 text-yellow-700'
                      }`}>
                        {l.status ?? 'PENDING'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
