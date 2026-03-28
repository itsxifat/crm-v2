'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Briefcase, Shield,
  ShieldCheck, FileText, Download, CheckCircle2, Clock, XCircle,
  User, Building2, CreditCard, Activity, Upload, Loader2, X, Image,
  Package, Plus, Pencil, Save,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Avatar from '@/components/ui/Avatar'
import TkAmt from '@/components/ui/TkAmt'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
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

  // Combine onboarding docs with employee.documents
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

const ITEM_PRESETS = [
  'Laptop', 'Desktop', 'Monitor', 'Keyboard', 'Mouse', 'Headphone',
  'Mobile Phone', 'SIM Card', 'Access Card', 'Office Key', 'Locker Key',
  'Desk', 'Chair', 'Hard Disk', 'Pen Drive', 'Webcam', 'Other',
]

function CompanyItemsTab({ emp, empId, onUpdated }) {
  const [items,   setItems]   = useState(() => (emp.companyItems ?? []).map((it, i) => ({ ...it, _id: i })))
  const [saving,  setSaving]  = useState(false)
  const [editIdx, setEditIdx] = useState(null)   // index being edited inline
  const [form,    setForm]    = useState({ item: '', value: '', description: '' })
  const [adding,  setAdding]  = useState(false)

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
                  {ITEM_PRESETS.map(p => <option key={p} value={p} />)}
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeProfilePage() {
  const { id } = useParams()
  const router  = useRouter()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('overview')

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
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
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
                <InfoRow icon={Phone}    label="Emergency Contact" value={emp.emergencyContact} />
                <InfoRow icon={CreditCard} label="NID Number"     value={emp.nidNumber} />
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
              </div>
            </div>
          </div>

          {/* Right: sidebar */}
          <div className="space-y-5">
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

      {/* Company Items Tab */}
      {tab === 'company-items' && (
        <CompanyItemsTab emp={emp} empId={id} onUpdated={setData} />
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
                    <td className="px-4 py-3 text-sm text-gray-800">{l.leaveType ?? '—'}</td>
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
