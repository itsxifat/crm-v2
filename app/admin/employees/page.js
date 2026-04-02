'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import {
  Plus, Search, MoreHorizontal, Eye, Pencil, Trash2, Users,
  Briefcase, Clock, Building2, Shield, ShieldCheck, Download,
  FileText, X, Loader2, ChevronDown, Link2, ClipboardList,
  CheckCircle, XCircle, ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import TkAmt from '@/components/ui/TkAmt'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmt = (n) => n != null ? `৳ ${Number(n).toLocaleString('en-BD')}` : '—'

const DEPT_CODES = {
  DEV: 'Development',
  MKT: 'Marketing',
  HR:  'Human Resources',
  SLS: 'Sales',
  ACC: 'Accounting',
  OPS: 'Operations',
  SUP: 'Support',
}

const ROLE_META = {
  SUPER_ADMIN: { label: 'Super Admin', bg: 'bg-red-50',     text: 'text-red-700'    },
  MANAGER:     { label: 'Manager',     bg: 'bg-blue-50',    text: 'text-blue-700'   },
  EMPLOYEE:    { label: 'Employee',    bg: 'bg-gray-100',   text: 'text-gray-600'   },
  FREELANCER:  { label: 'Freelancer',  bg: 'bg-purple-50',  text: 'text-purple-700' },
  CLIENT:      { label: 'Client',      bg: 'bg-green-50',   text: 'text-green-700'  },
  VENDOR:      { label: 'Vendor',      bg: 'bg-orange-50',  text: 'text-orange-700' },
}

function RoleBadge({ role }) {
  const m = ROLE_META[role] ?? { label: role, bg: 'bg-gray-100', text: 'text-gray-500' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  )
}

// ─── Employee Modal ───────────────────────────────────────────────────────────

function EmployeeModal({ open, onClose, employee, onSaved, customRoles = [], ventures = [] }) {
  const isEdit = !!employee
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '',
    venture: '', department: '', position: '', designation: '', salary: '',
    hireDate: '', role: 'EMPLOYEE', customRoleId: '',
    bloodGroup: '', emergencyContact: '', address: '', nidNumber: '',
    appointmentLetterUrl: '', agreementUrl: '',
    panelAccessGranted: false,
  })

  useEffect(() => {
    if (!open) return
    if (isEdit) {
      setForm({
        name:                 employee.userId?.name ?? '',
        email:                employee.userId?.email ?? '',
        phone:                employee.userId?.phone ?? '',
        password:             '',
        venture:              employee.venture ?? '',
        department:           employee.department ?? '',
        position:             employee.position ?? '',
        designation:          employee.designation ?? '',
        salary:               employee.salary ?? '',
        hireDate:             employee.hireDate ? employee.hireDate.slice(0, 10) : '',
        role:                 employee.userId?.role ?? 'EMPLOYEE',
        customRoleId:         employee.customRoleId?.id ?? employee.customRoleId ?? '',
        bloodGroup:           employee.bloodGroup ?? '',
        emergencyContact:     employee.emergencyContact ?? '',
        address:              employee.address ?? '',
        nidNumber:            employee.nidNumber ?? '',
        appointmentLetterUrl: employee.appointmentLetterUrl ?? '',
        agreementUrl:         employee.agreementUrl ?? '',
        panelAccessGranted:   employee.panelAccessGranted ?? false,
      })
    } else {
      setForm({
        name: '', email: '', phone: '', password: '',
        venture: '', department: '', position: '', designation: '', salary: '',
        hireDate: '', role: 'EMPLOYEE', customRoleId: '',
        bloodGroup: '', emergencyContact: '', address: '', nidNumber: '',
        appointmentLetterUrl: '', agreementUrl: '',
        panelAccessGranted: false,
      })
    }
  }, [open, employee, isEdit])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name:                 form.name,
        email:                form.email,
        phone:                form.phone || null,
        venture:              form.venture || null,
        department:           form.department || null,
        position:             form.position || null,
        designation:          form.designation || null,
        salary:               form.salary ? Number(form.salary) : null,
        hireDate:             form.hireDate ? new Date(form.hireDate).toISOString() : null,
        role:                 form.role,
        bloodGroup:           form.bloodGroup || null,
        emergencyContact:     form.emergencyContact || null,
        address:              form.address || null,
        nidNumber:            form.nidNumber || null,
        appointmentLetterUrl: form.appointmentLetterUrl || null,
        agreementUrl:         form.agreementUrl || null,
        panelAccessGranted:   form.panelAccessGranted,
        customRoleId:         form.customRoleId || null,
      }
      if (form.password) body.password = form.password

      const url    = isEdit ? `/api/employees/${employee.id}` : '/api/employees'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      onSaved(json.data, !isEdit ? json.tempPassword : null)
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
  const lc = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Employee' : 'Add New Employee'}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{isEdit ? `ID: ${employee.employeeId}` : 'Employee ID will be auto-generated'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form id="emp-form" onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Section: Personal Info */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Personal Information</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className={lc}>Full Name *</label>
                <input required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Md. Hasan Ali" className={ic} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className={lc}>Email *</label>
                <input required type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="hasan@company.com" className={ic} disabled={isEdit} />
              </div>
              <div>
                <label className={lc}>Phone</label>
                <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+8801XXXXXXXXX" className={ic} />
              </div>
              <div>
                <label className={lc}>Blood Group</label>
                <Select value={form.bloodGroup} onChange={v => set('bloodGroup', v ?? '')}
                  options={['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => ({ value: g, label: g }))}
                  placeholder="Select…"
                />
              </div>
              <div className="col-span-2">
                <label className={lc}>Address</label>
                <input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Dhaka, Bangladesh" className={ic} />
              </div>
              <div>
                <label className={lc}>NID Number</label>
                <input value={form.nidNumber} onChange={e => set('nidNumber', e.target.value)} placeholder="19XXXXXXXXXXXXXXX" className={ic} />
              </div>
              <div>
                <label className={lc}>Emergency Contact</label>
                <input value={form.emergencyContact} onChange={e => set('emergencyContact', e.target.value)} placeholder="+8801XXXXXXXXX" className={ic} />
              </div>
            </div>
          </div>

          {/* Section: Employment */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Employment Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lc}>Venture</label>
                <Select value={form.venture} onChange={v => set('venture', v ?? '')}
                  options={ventures.map(v => ({ value: v.id, label: v.label }))}
                  placeholder="— All / Not assigned —"
                />
              </div>
              <div>
                <label className={lc}>Department</label>
                <Select value={form.department} onChange={v => set('department', v ?? '')}
                  options={Object.entries(DEPT_CODES).map(([code, label]) => ({ value: code, label: `${label} (${code})` }))}
                  placeholder="— Not assigned —"
                />
              </div>
              <div>
                <label className={lc}>Position / Job Title</label>
                <input value={form.position} onChange={e => set('position', e.target.value)} placeholder="Senior Designer" className={ic} />
              </div>
              <div>
                <label className={lc}>Designation</label>
                <input value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="Creative Lead" className={ic} />
              </div>
              <div>
                <label className={lc}>Org Role & Permissions</label>
                <Select value={form.customRoleId} onChange={v => set('customRoleId', v ?? '')}
                  options={customRoles.map(r => ({ value: r.id, label: `${r.title} · ${r.department}` }))}
                  placeholder="— No role assigned —"
                />
                {form.customRoleId && (() => {
                  const cr = customRoles.find(r => r.id === form.customRoleId)
                  return cr ? (
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: cr.color ?? '#6366f1' }} />
                      {cr.title} — permissions set in Roles & Permissions
                    </p>
                  ) : null
                })()}
              </div>
              <div>
                <label className={lc}>Monthly Salary (৳)</label>
                <input type="number" min="0" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="50000" className={ic} />
              </div>
              <div>
                <label className={lc}>Hire Date</label>
                <DatePicker value={form.hireDate || null} onChange={v => set('hireDate', v ?? '')} />
              </div>
            </div>
          </div>

          {/* Section: Documents */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Documents</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lc}>Appointment Letter URL</label>
                <input value={form.appointmentLetterUrl} onChange={e => set('appointmentLetterUrl', e.target.value)} placeholder="https://…" className={ic} />
              </div>
              <div>
                <label className={lc}>Agreement URL</label>
                <input value={form.agreementUrl} onChange={e => set('agreementUrl', e.target.value)} placeholder="https://…" className={ic} />
              </div>
            </div>
          </div>

          {/* Section: Panel Access */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Panel Access</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.panelAccessGranted} onChange={e => set('panelAccessGranted', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600" />
              <span className="text-sm text-gray-700">Grant panel access</span>
            </label>
            {!isEdit && (
              <p className="text-xs text-gray-400 mt-2">A temporary password will be auto-generated and shown once after creation.</p>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="submit" form="emp-form" disabled={saving}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Onboarding Review Modal ──────────────────────────────────────────────────

function OnboardingReviewModal({ open, record, onClose, onDone, customRoles = [], ventures = [] }) {
  const [saving, setSaving]     = useState(false)
  const [tab, setTab]           = useState('self')   // 'self' | 'hr'
  const [form, setForm]         = useState({
    venture: '', department: '', position: '', designation: '', salary: '',
    hireDate: '', role: 'EMPLOYEE', customRoleId: '', appointmentLetterUrl: '',
    agreementUrl: '', panelAccessGranted: false, password: '',
    companyPhone: '', companyWebmail: '',
    companyItems: [],
    hrNote: '',
  })
  const [newItem, setNewItem] = useState({ item: '', value: '', description: '' })

  useEffect(() => {
    if (!open || !record) return
    setTab('self')
    setForm(f => ({
      ...f,
      venture: record.hrData?.venture ?? '',
      department: record.hrData?.department ?? record.selfData?.department ?? '',
      position: record.hrData?.position ?? '',
      designation: record.hrData?.designation ?? '',
      salary: record.hrData?.salary ?? '',
      hireDate: record.hrData?.hireDate ? record.hrData.hireDate.slice(0, 10) : '',
      role: record.hrData?.role ?? 'EMPLOYEE',
      customRoleId: record.hrData?.customRoleId ?? '',
      appointmentLetterUrl: record.hrData?.appointmentLetterUrl ?? '',
      agreementUrl: record.hrData?.agreementUrl ?? '',
      panelAccessGranted: record.hrData?.panelAccessGranted ?? false,
      password: '',
      companyPhone: record.hrData?.companyPhone ?? '',
      companyWebmail: record.hrData?.companyWebmail ?? '',
      companyItems: record.hrData?.companyItems ?? [],
      hrNote: record.hrNote ?? '',
    }))
  }, [open, record])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addItem() {
    if (!newItem.item.trim()) return
    setForm(f => ({ ...f, companyItems: [...f.companyItems, { ...newItem }] }))
    setNewItem({ item: '', value: '', description: '' })
  }

  function removeItem(i) {
    setForm(f => ({ ...f, companyItems: f.companyItems.filter((_, idx) => idx !== i) }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        venture:              form.venture       || null,
        department:           form.department    || null,
        position:             form.position      || null,
        designation:          form.designation   || null,
        salary:               form.salary        ? Number(form.salary) : null,
        hireDate:             form.hireDate      ? new Date(form.hireDate).toISOString() : null,
        customRoleId:         form.customRoleId  || null,
        appointmentLetterUrl: form.appointmentLetterUrl || null,
        agreementUrl:         form.agreementUrl  || null,
        companyPhone:         form.companyPhone  || null,
        companyWebmail:       form.companyWebmail || null,
        companyItems:         form.companyItems,
        hrNote:               form.hrNote        || null,
      }
      const res  = await fetch(`/api/onboarding/${record.token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success('Employment details saved')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open || !record) return null

  const sd  = record.selfData ?? {}
  const ic  = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
  const lc  = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add Employment Details</h2>
            <p className="text-xs text-gray-400 mt-0.5">{sd.name ?? record.email} · Account already active</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          {[['self', 'Employee Info'], ['hr', 'HR Details']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`py-2.5 mr-4 text-sm font-medium border-b-2 transition-colors ${tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

          {/* Tab: Employee submitted info (read-only) */}
          {tab === 'self' && (
            <div className="space-y-4">
              {sd.photo && (
                <div className="flex items-center gap-3">
                  <Image src={sd.photo} alt="photo" width={64} height={64} className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{sd.name}</p>
                    <p className="text-xs text-gray-400">{sd.email}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['Primary Phone', sd.phone],
                  ['Secondary Phone', sd.secondaryPhone],
                  ['Home Phone', sd.homePhone],
                  ['Date of Birth', sd.dateOfBirth ? new Date(sd.dateOfBirth).toLocaleDateString('en-GB') : null],
                  ['Blood Group', sd.bloodGroup],
                  ['NID Number', sd.nidNumber],
                  ['Emergency Contact', sd.emergencyContact],
                  ['Address', sd.address],
                ].map(([label, value]) => value ? (
                  <div key={label} className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-gray-700 mt-0.5">{value}</p>
                  </div>
                ) : null)}
              </div>
              {sd.documents?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Documents</p>
                  <div className="space-y-1.5">
                    {sd.documents.map((doc, i) => (
                      <a key={i} href={doc.url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{doc.url.split('/').pop()}</span>
                        <span className="ml-auto text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{doc.type}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {!sd.name && <p className="text-sm text-gray-400 text-center py-8">No data submitted yet</p>}
            </div>
          )}

          {/* Tab: HR fills employment details */}
          {tab === 'hr' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Employment Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lc}>Venture</label>
                    <Select value={form.venture} onChange={v => set('venture', v ?? '')}
                      options={ventures.map(v => ({ value: v.id, label: v.label }))}
                      placeholder="— Not assigned —"
                    />
                  </div>
                  <div>
                    <label className={lc}>Department</label>
                    <Select value={form.department} onChange={v => set('department', v ?? '')}
                      options={Object.entries(DEPT_CODES).map(([code, label]) => ({ value: code, label: `${label} (${code})` }))}
                      placeholder="— Not assigned —"
                    />
                  </div>
                  <div>
                    <label className={lc}>Position / Job Title</label>
                    <input className={ic} value={form.position} onChange={e => set('position', e.target.value)} placeholder="Senior Designer" />
                  </div>
                  <div>
                    <label className={lc}>Designation</label>
                    <input className={ic} value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="Creative Lead" />
                  </div>
                  <div>
                    <label className={lc}>Monthly Salary (৳)</label>
                    <input className={ic} type="number" min="0" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="50000" />
                  </div>
                  <div>
                    <label className={lc}>Hire Date</label>
                    <DatePicker value={form.hireDate || null} onChange={v => set('hireDate', v ?? '')} />
                  </div>
                  <div>
                    <label className={lc}>Org Role & Permissions</label>
                    <Select value={form.customRoleId} onChange={v => set('customRoleId', v ?? '')}
                      options={customRoles.map(r => ({ value: r.id, label: `${r.title} · ${r.department}` }))}
                      placeholder="— No role —"
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Company Provided Items</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className={lc}>Company Phone</label>
                    <input className={ic} value={form.companyPhone} onChange={e => set('companyPhone', e.target.value)} placeholder="+880…" />
                  </div>
                  <div>
                    <label className={lc}>Company Webmail</label>
                    <input className={ic} value={form.companyWebmail} onChange={e => set('companyWebmail', e.target.value)} placeholder="name@company.com" />
                  </div>
                </div>
                {/* Additional company items */}
                {form.companyItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2 p-2 bg-gray-50 rounded-lg">
                    <div className="flex-1 text-sm">
                      <span className="font-medium text-gray-700">{item.item}</span>
                      {item.value && <span className="text-gray-500"> — {item.value}</span>}
                    </div>
                    <button type="button" onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 mt-2">
                  <input className={ic} placeholder="Item name (e.g. Laptop)" value={newItem.item}
                    onChange={e => setNewItem(n => ({ ...n, item: e.target.value }))} />
                  <input className={ic} placeholder="Value" value={newItem.value}
                    onChange={e => setNewItem(n => ({ ...n, value: e.target.value }))} />
                  <button type="button" onClick={addItem}
                    className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 shrink-0">
                    Add
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                <p className="text-xs text-green-700">Panel access is already active — employee set their own credentials when submitting the form.</p>
              </div>

              <div>
                <label className={lc}>HR Note (optional)</label>
                <textarea className={ic} rows={2} value={form.hrNote}
                  onChange={e => set('hrNote', e.target.value)} placeholder="Internal notes…" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Close
          </button>
          {tab === 'self' ? (
            <button type="button" onClick={() => setTab('hr')}
              className="flex items-center gap-1.5 px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
              Employment Details <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Save Employment Details
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Row Menu ─────────────────────────────────────────────────────────────────

function RowMenu({ employee, onEdit, onDeleted, onRoleChanged }) {
  const [open,        setOpen]        = useState(false)
  const [roleMode,    setRoleMode]    = useState(false)
  const [changingRole, setChangingRole] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setRoleMode(false) } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  async function handleDelete() {
    setOpen(false)
    if (!confirm(`Remove employee ${employee.userId?.name}?`)) return
    try {
      const res = await fetch(`/api/employees/${employee.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Employee removed')
      onDeleted(employee.id)
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleRoleChange(newRole) {
    if (newRole === employee.userId?.role) { setOpen(false); setRoleMode(false); return }
    setChangingRole(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(`Role changed to ${ROLE_META[newRole]?.label ?? newRole}`)
      onRoleChanged(employee.id, newRole)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setChangingRole(false)
      setOpen(false)
      setRoleMode(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(o => !o); setRoleMode(false) }}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-[9999] w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 text-sm">
          {!roleMode ? (<>
            <Link href={`/admin/employees/${employee.id}`}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
              <Eye className="w-3.5 h-3.5 text-gray-400" /> View Profile
            </Link>
            <button onClick={() => { setOpen(false); onEdit(employee) }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
              <Pencil className="w-3.5 h-3.5 text-gray-400" /> Edit
            </button>
            <button onClick={() => setRoleMode(true)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
              <Shield className="w-3.5 h-3.5 text-gray-400" /> Change Role
            </button>
            {employee.appointmentLetterUrl && (
              <a href={employee.appointmentLetterUrl} target="_blank" rel="noreferrer"
                className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
                <Download className="w-3.5 h-3.5 text-gray-400" /> Appointment Letter
              </a>
            )}
            {employee.agreementUrl && (
              <a href={employee.agreementUrl} target="_blank" rel="noreferrer"
                className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
                <FileText className="w-3.5 h-3.5 text-gray-400" /> Agreement
              </a>
            )}
            <div className="border-t border-gray-100 my-1" />
            <button onClick={handleDelete}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </>) : (<>
            <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center justify-between">
              <span>Change Role</span>
              <button onClick={() => setRoleMode(false)} className="text-gray-300 hover:text-gray-500"><X className="w-3 h-3" /></button>
            </div>
            <div className="border-t border-gray-100" />
            {Object.entries(ROLE_META).map(([role, { label, bg, text }]) => (
              <button key={role} onClick={() => handleRoleChange(role)} disabled={changingRole}
                className={`w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 disabled:opacity-50 ${employee.userId?.role === role ? 'font-semibold' : ''}`}>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>{label}</span>
                {employee.userId?.role === role && <span className="text-xs text-gray-400">current</span>}
              </button>
            ))}
          </>)}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const [employees,  setEmployees]  = useState([])
  const [stats,      setStats]      = useState(null)
  const [meta,       setMeta]       = useState({ page: 1, pages: 1, total: 0 })
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [department, setDepartment] = useState('')
  const [year,       setYear]       = useState('')
  const [sortBy,     setSortBy]     = useState('')
  const [page,       setPage]       = useState(1)
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [customRoles,  setCustomRoles]  = useState([])
  const [ventures,     setVentures]     = useState([])
  const [obPanel,      setObPanel]      = useState(false)   // onboarding submissions panel
  const [obRecords,    setObRecords]    = useState([])
  const [obLoading,    setObLoading]    = useState(false)
  const [obRecord,     setObRecord]     = useState(null)    // reviewing
  const [obReviewOpen, setObReviewOpen] = useState(false)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendEmail,     setSendEmail]     = useState('')
  const [sendName,      setSendName]      = useState('')
  const [sending,       setSending]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page, limit: 20 })
      if (search)     p.set('search',     search)
      if (department) p.set('department', department)
      if (year)       p.set('year',       year)
      if (sortBy)     p.set('sortBy',     sortBy)
      const res  = await fetch(`/api/employees?${p}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEmployees(json.data ?? [])
      setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
      if (json.stats) setStats(json.stats)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, search, department, year, sortBy])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/onboarding?status=APPROVED')
      .then(r => r.json())
      .then(j => setObRecords(j.data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/custom-roles')
      .then(r => r.json())
      .then(j => setCustomRoles(j.data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(j => setVentures((j.data?.ventures ?? []).filter(v => v.active !== false)))
      .catch(() => {})
  }, [])

  async function loadOnboarding() {
    setObLoading(true)
    try {
      const res  = await fetch('/api/onboarding?status=APPROVED')
      const json = await res.json()
      setObRecords(json.data ?? [])
    } catch { /* ignore */ } finally {
      setObLoading(false)
    }
  }

  function openObPanel() {
    setObPanel(true)
    loadOnboarding()
  }

  async function handleSendOnboarding() {
    if (!sendEmail.trim()) { toast.error('Enter the employee email'); return }
    setSending(true)
    try {
      const res  = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sendEmail.trim(), name: sendName.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      if (json.emailSent) {
        toast.success(`Onboarding email sent to ${sendEmail}`)
      } else {
        // Email failed but link was created — copy as fallback
        await navigator.clipboard.writeText(json.link).catch(() => {})
        toast.error('Email could not be sent — link copied to clipboard instead', { duration: 6000 })
      }
      setSendModalOpen(false)
      setSendEmail('')
      setSendName('')
      loadOnboarding()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  function handleSaved(emp, tempPw) {
    if (tempPw) toast.success(`Employee added! Temp password: ${tempPw}`, { duration: 8000 })
    else        toast.success(editing ? 'Employee updated' : 'Employee added')
    setEditing(null)
    load()
  }

  function handleDeleted(id) {
    setEmployees(p => p.filter(e => e.id !== id))
  }

  function handleRoleChanged(id, newRole) {
    setEmployees(p => p.map(e => e.id !== id ? e : { ...e, userId: { ...e.userId, role: newRole } }))
  }

  const STAT_CARDS = stats ? [
    { label: 'Total Employees',  value: stats.totalEmployees,    icon: Users,      bg: 'bg-blue-50',   color: 'text-blue-600' },
    { label: 'Active Tasks',     value: stats.activeTasks,       icon: Briefcase,  bg: 'bg-green-50',  color: 'text-green-600' },
    { label: 'On Leave Today',   value: stats.onLeaveToday,      icon: Clock,      bg: 'bg-yellow-50', color: 'text-yellow-600' },
    { label: 'Departments',      value: stats.departmentCount,   icon: Building2,  bg: 'bg-purple-50', color: 'text-purple-600' },
  ] : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage team members, profiles and panel access</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openObPanel}
            className="relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <ClipboardList className="w-4 h-4" /> Onboarding
            {obRecords.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {obRecords.length}
              </span>
            )}
          </button>
          <button onClick={() => setSendModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 border border-indigo-200 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
            <Link2 className="w-4 h-4" /> Send Onboarding
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STAT_CARDS.map(({ label, value, icon: Icon, bg, color }) => (
            <div key={label} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-900">{value ?? 0}</p>
                <p className="text-xs text-gray-400">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by name, email, ID…"
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
          />
        </div>
        <Select value={department} onChange={v => { setDepartment(v ?? ''); setPage(1) }}
          options={Object.entries(DEPT_CODES).map(([code, label]) => ({ value: code, label }))}
          placeholder="All Departments"
          className="w-44"
          size="sm"
        />
        <Select value={year} onChange={v => { setYear(v ?? ''); setPage(1) }}
          options={Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => ({ value: String(y), label: String(y) }))}
          placeholder="All Years"
          className="w-28"
          size="sm"
        />
        <Select value={sortBy} onChange={v => { setSortBy(v ?? ''); setPage(1) }}
          options={[{ value: 'employeeId', label: 'Sort: Employee ID' }]}
          placeholder="Sort: Newest First"
          className="w-40"
          size="sm"
        />
        <span className="text-xs text-gray-400 ml-auto">{meta.total} employee{meta.total !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">No employees found</p>
            {search && <p className="text-xs text-gray-400 mt-1">Try a different search term</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Designation</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Salary</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Hire Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Tasks</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Panel</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Docs</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50/60 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={emp.userId?.name} src={emp.userId?.avatar} size="sm" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{emp.userId?.name ?? '—'}</p>
                          <p className="text-xs text-gray-400">{emp.userId?.email ?? ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {emp.employeeId ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{emp.department ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-gray-700">{emp.designation || emp.position || '—'}</p>
                        {emp.designation && emp.position && (
                          <p className="text-xs text-gray-400">{emp.position}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700"><TkAmt value={emp.salary} /></td>
                    <td className="px-4 py-3 text-sm text-gray-500">{fmtDate(emp.hireDate)}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">{emp.activeTaskCount ?? 0} active</span>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={emp.userId?.role ?? 'EMPLOYEE'} />
                      {emp.customRoleId && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: emp.customRoleId.color ?? '#6366f1' }} />
                          <span className="text-xs text-gray-500 truncate max-w-[100px]">{emp.customRoleId.title}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {emp.panelAccessGranted ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <ShieldCheck className="w-3.5 h-3.5" /> Granted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <Shield className="w-3.5 h-3.5" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {emp.appointmentLetterUrl && (
                          <a href={emp.appointmentLetterUrl} target="_blank" rel="noreferrer" title="Appointment Letter"
                            className="text-blue-500 hover:text-blue-700 transition-colors">
                            <FileText className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {emp.agreementUrl && (
                          <a href={emp.agreementUrl} target="_blank" rel="noreferrer" title="Agreement"
                            className="text-purple-500 hover:text-purple-700 transition-colors">
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {!emp.appointmentLetterUrl && !emp.agreementUrl && (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <RowMenu
                        employee={emp}
                        onEdit={e => { setEditing(e); setModalOpen(true) }}
                        onDeleted={handleDeleted}
                        onRoleChanged={handleRoleChanged}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {meta.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">Page {meta.page} of {meta.pages}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
                Prev
              </button>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <EmployeeModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        employee={editing}
        onSaved={handleSaved}
        customRoles={customRoles}
        ventures={ventures}
      />

      {/* Onboarding submissions panel */}
      {obPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setObPanel(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Onboarding Submissions</h2>
                <p className="text-xs text-gray-400 mt-0.5">Review submitted employee onboarding forms</p>
              </div>
              <button onClick={() => setObPanel(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {obLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                </div>
              ) : obRecords.length === 0 ? (
                <div className="text-center py-12">
                  <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No pending submissions</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {obRecords.map(r => (
                    <div key={r.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{r.selfData?.name ?? r.email ?? 'Unknown'}</p>
                        <p className="text-xs text-gray-400">{r.selfData?.email ?? r.email} · Submitted {new Date(r.submittedAt).toLocaleDateString('en-GB')}</p>
                      </div>
                      <button
                        onClick={() => { setObRecord(r); setObReviewOpen(true); setObPanel(false) }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shrink-0">
                        Review <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Send Onboarding Email Modal */}
      {sendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSendModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Send Onboarding Invitation</h2>
                <p className="text-xs text-gray-400 mt-0.5">Employee will receive an email with the form link</p>
              </div>
              <button onClick={() => setSendModalOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Employee Name (optional)</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Md. Rahim Uddin"
                  value={sendName}
                  onChange={e => setSendName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Employee Email *</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  type="email"
                  placeholder="employee@example.com"
                  value={sendEmail}
                  onChange={e => setSendEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendOnboarding()}
                  autoFocus
                />
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700 leading-relaxed">
                  An email will be sent with a secure link. The employee can open it, fill in their details and upload documents — their panel account will be created automatically on submission.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 pb-5">
              <button onClick={() => setSendModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSendOnboarding} disabled={sending}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      <OnboardingReviewModal
        open={obReviewOpen}
        record={obRecord}
        onClose={() => setObReviewOpen(false)}
        onDone={() => { loadOnboarding(); load() }}
        customRoles={customRoles}
        ventures={ventures}
      />
    </div>
  )
}
