'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Select from '@/components/ui/Select'
import {
  Plus, Search, MoreHorizontal, Eye, Pencil, Users,
  Briefcase, Clock, Building2, Shield, ShieldCheck, Download,
  FileText, X, Loader2, LogOut, Settings, Trash2, Check,
  SlidersHorizontal, RotateCcw, ChevronDown, ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import TkAmt from '@/components/ui/TkAmt'
import { Can, usePermission } from '@/components/auth/Can'
import {
  PERMISSION_MODULES, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS,
  applyPermissionOverrides,
} from '@/lib/rbac'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmt = (n) => n != null ? `৳ ${Number(n).toLocaleString('en-BD')}` : '—'

// Auto-generate a short code from a department name (mirrors server logic)
function autoShortCode(name) {
  if (!name) return ''
  const words = name.trim().split(/[\s&\/\-_]+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').toUpperCase()
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

function EmployeeModal({ open, onClose, employee, onSaved, customRoles = [], ventures = [], departments = [] }) {
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
            </div>
            {!isEdit && (
              <p className="text-xs text-blue-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mt-3">
                An email with login credentials and onboarding details will be sent to this email address once the employee is created.
              </p>
            )}
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
                  options={departments.map(d => ({ value: d.shortCode, label: `${d.name} (${d.shortCode})` }))}
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
                <input type="date" value={form.hireDate} onChange={e => set('hireDate', e.target.value)} className={ic} />
              </div>
            </div>
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

// ─── Manage Departments Modal ─────────────────────────────────────────────────

function ManageDepartmentsModal({ open, onClose, departments, onChanged }) {
  const [form,     setForm]     = useState({ name: '', shortCode: '', description: '' })
  const [editing,  setEditing]  = useState(null) // { id, name, shortCode, description }
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(null) // id being deleted

  // Auto-update shortCode when name changes (only if not manually edited)
  const [codeManual, setCodeManual] = useState(false)

  function handleNameChange(v) {
    setForm(f => ({ ...f, name: v, shortCode: codeManual ? f.shortCode : autoShortCode(v) }))
  }
  function handleCodeChange(v) {
    setCodeManual(true)
    setForm(f => ({ ...f, shortCode: v.toUpperCase() }))
  }

  function resetForm() {
    setForm({ name: '', shortCode: '', description: '' })
    setCodeManual(false)
    setEditing(null)
  }

  function startEdit(dept) {
    setEditing(dept)
    setForm({ name: dept.name, shortCode: dept.shortCode, description: dept.description ?? '' })
    setCodeManual(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const isEdit = !!editing
      const url    = isEdit ? `/api/departments/${editing.id}` : '/api/departments'
      const method = isEdit ? 'PUT' : 'POST'
      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, shortCode: form.shortCode, description: form.description }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(isEdit ? 'Department updated' : 'Department added')
      resetForm()
      onChanged()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Deactivate this department? Existing employees will keep their current department code.')) return
    setDeleting(id)
    try {
      const res  = await fetch(`/api/departments/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Department deactivated')
      onChanged()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleting(null)
    }
  }

  if (!open) return null

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
  const lc = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { resetForm(); onClose() }} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Manage Departments</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add or edit departments used for employee grouping</p>
          </div>
          <button onClick={() => { resetForm(); onClose() }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Add / Edit form */}
          <form onSubmit={handleSave} className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {editing ? 'Edit Department' : 'Add New Department'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={lc}>Department Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="e.g. Human Resources"
                  className={ic}
                />
              </div>
              <div>
                <label className={lc}>Short Code *</label>
                <input
                  required
                  value={form.shortCode}
                  onChange={e => handleCodeChange(e.target.value)}
                  placeholder="e.g. HR"
                  maxLength={6}
                  className={`${ic} font-mono uppercase`}
                />
                <p className="text-xs text-gray-400 mt-1">Used in employee ID. Auto-generated, you can edit.</p>
              </div>
              <div>
                <label className={lc}>Description</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional"
                  className={ic}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Department'}
              </button>
              {editing && (
                <button type="button" onClick={resetForm}
                  className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
              )}
            </div>
          </form>

          {/* Departments list */}
          {departments.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Existing Departments</p>
              <div className="space-y-1">
                {departments.map(dept => (
                  <div key={dept.id}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${editing?.id === dept.id ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs font-semibold text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded shrink-0">
                        {dept.shortCode}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{dept.name}</p>
                        {dept.description && <p className="text-xs text-gray-400 truncate">{dept.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button onClick={() => startEdit(dept)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white rounded-lg transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(dept.id)} disabled={deleting === dept.id}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors disabled:opacity-40">
                        {deleting === dept.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {departments.length === 0 && (
            <div className="text-center py-8 text-sm text-gray-400">
              No departments yet. Add one above.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Row Menu ─────────────────────────────────────────────────────────────────

// ─── Per-User Permissions Modal ───────────────────────────────────────────────

function PermToggle({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-150 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function EmployeePermissionsModal({ open, onClose, employee, customRoles = [], onSaved }) {
  const [active,   setActive]   = useState(new Set())
  const [search,   setSearch]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [collapsed, setCollapsed] = useState(new Set())

  // Baseline = the assigned custom role's permissions, or the base-role defaults.
  const baseRole = employee?.userId?.role ?? 'EMPLOYEE'
  const roleId   = employee?.customRoleId?.id ?? employee?.customRoleId ?? null
  const roleObj  = roleId ? customRoles.find(r => r.id === roleId) : null
  const baselineSet = useMemo(
    () => new Set(roleObj?.permissions ?? DEFAULT_ROLE_PERMISSIONS[baseRole] ?? []),
    [roleObj, baseRole],
  )

  useEffect(() => {
    if (!open || !employee) return
    const base = roleObj?.permissions ?? DEFAULT_ROLE_PERMISSIONS[baseRole] ?? []
    setActive(new Set(applyPermissionOverrides(base, employee.permissionOverrides)))
    setSearch('')
    setCollapsed(new Set())
  }, [open, employee, roleObj, baseRole])

  const overrideCount = useMemo(() => {
    let n = 0
    ALL_PERMISSIONS.forEach(p => { if (active.has(p) !== baselineSet.has(p)) n++ })
    return n
  }, [active, baselineSet])

  if (!open || !employee) return null

  const q = search.trim().toLowerCase()
  const toggle = (key) => setActive(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleModule = (keys, val) => setActive(prev => { const n = new Set(prev); keys.forEach(k => val ? n.add(k) : n.delete(k)); return n })
  const toggleCollapse = (key) => setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  async function save() {
    const added   = [...active].filter(p => !baselineSet.has(p))
    const removed = [...baselineSet].filter(p => !active.has(p))
    setSaving(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionOverrides: { added, removed } }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Permissions updated')
      onSaved(employee.id, { added, removed })
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const sourceLabel = roleObj ? `${roleObj.title} · ${roleObj.department}` : `Default ${ROLE_META[baseRole]?.label ?? baseRole} permissions`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl ring-1 ring-black/5 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900 truncate">Permissions · {employee.userId?.name}</h2>
              <p className="text-xs text-gray-400 truncate">Baseline: {sourceLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search permissions…"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <span className="text-xs text-gray-400">
            <span className="font-semibold text-gray-600">{active.size}</span> enabled
            {overrideCount > 0 && <> · <span className="font-semibold text-amber-600">{overrideCount}</span> customised</>}
          </span>
          <button type="button" onClick={() => setActive(new Set(baselineSet))} disabled={saving || overrideCount === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <RotateCcw className="w-3 h-3" /> Reset to role
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          <p className="text-xs text-gray-400">
            Toggles set this person&apos;s access individually. Anything different from the baseline role is saved as a personal override.
          </p>
          {PERMISSION_MODULES.map(module => {
            const perms = q
              ? module.permissions.filter(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
              : module.permissions
            if (perms.length === 0) return null
            const keys = module.permissions.map(p => p.key)
            const enabled = keys.filter(k => active.has(k)).length
            const allOn = enabled === keys.length
            const isCollapsed = collapsed.has(module.key)
            return (
              <div key={module.key} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/70 border-b border-gray-100">
                  <button type="button" onClick={() => toggleCollapse(module.key)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide truncate">{module.label}</span>
                  </button>
                  <span className="text-xs text-gray-400 shrink-0">{enabled}/{keys.length}</span>
                  <button type="button" disabled={saving} onClick={() => toggleModule(keys, !allOn)}
                    className={`text-xs px-2 py-0.5 rounded-md font-medium border shrink-0 transition-colors ${allOn ? 'text-red-600 border-red-100 hover:bg-red-50' : 'text-blue-600 border-blue-100 hover:bg-blue-50'}`}>
                    {allOn ? 'Remove all' : 'Grant all'}
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="divide-y divide-gray-50">
                    {perms.map(perm => {
                      const on = active.has(perm.key)
                      const overridden = on !== baselineSet.has(perm.key)
                      return (
                        <div key={perm.key} onClick={() => !saving && toggle(perm.key)}
                          className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                          <div className="min-w-0">
                            <p className={`text-sm ${on ? 'text-gray-800' : 'text-gray-500'} flex items-center gap-1.5`}>
                              {perm.label}
                              {overridden && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Overridden for this person" />}
                            </p>
                            <p className="text-xs text-gray-300 font-mono truncate">{perm.key}</p>
                          </div>
                          <PermToggle checked={on} onChange={() => toggle(perm.key)} disabled={saving} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2 transition-colors">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save Permissions
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Row Menu ─────────────────────────────────────────────────────────────────

function RowMenu({ employee, onEdit, onResigned, onCustomRoleChanged, onEditPermissions, customRoles = [] }) {
  const [open,        setOpen]        = useState(false)
  const [roleMode,    setRoleMode]    = useState(false)
  const [changingRole, setChangingRole] = useState(false)
  const [resigning,   setResigning]   = useState(false)
  const { can } = usePermission()
  const canEdit = can('hr.employees.update')
  const canManageRoles = can('hr.roles.manage')
  const currentRoleId = employee.customRoleId?.id ?? employee.customRoleId ?? null
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setRoleMode(false) } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  async function handleResign() {
    setOpen(false)
    if (!confirm(`Mark ${employee.userId?.name} as resigned? Their panel access will be deactivated.`)) return
    setResigning(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resign: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Employee marked as resigned')
      onResigned(employee.id)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setResigning(false)
    }
  }

  async function handleCustomRoleChange(roleId) {
    if ((roleId ?? null) === (currentRoleId ?? null)) { setOpen(false); setRoleMode(false); return }
    setChangingRole(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customRoleId: roleId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      const assigned = roleId ? customRoles.find(r => r.id === roleId) : null
      toast.success(assigned ? `Role set to ${assigned.title}` : 'Role removed')
      onCustomRoleChanged(employee.id, assigned
        ? { id: assigned.id, title: assigned.title, department: assigned.department, color: assigned.color }
        : null)
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
            {canEdit && (
              <button onClick={() => { setOpen(false); onEdit(employee) }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
                <Pencil className="w-3.5 h-3.5 text-gray-400" /> Edit
              </button>
            )}
            {canEdit && (
              <button onClick={() => setRoleMode(true)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
                <Shield className="w-3.5 h-3.5 text-gray-400" /> Change Role
              </button>
            )}
            {canManageRoles && (
              <button onClick={() => { setOpen(false); onEditPermissions(employee) }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
                <SlidersHorizontal className="w-3.5 h-3.5 text-gray-400" /> Permissions
              </button>
            )}
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
            {canEdit && <div className="border-t border-gray-100 my-1" />}
            {canEdit && (employee.resigned ? (
              <span className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-400 cursor-default text-xs">
                <LogOut className="w-3.5 h-3.5" /> Already Resigned
              </span>
            ) : (
              <button onClick={handleResign} disabled={resigning}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-orange-600 hover:bg-orange-50 disabled:opacity-50">
                <LogOut className="w-3.5 h-3.5" /> Resigned
              </button>
            ))}
          </>) : (<>
            <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center justify-between">
              <span>Assign Role</span>
              <button onClick={() => setRoleMode(false)} className="text-gray-300 hover:text-gray-500"><X className="w-3 h-3" /></button>
            </div>
            <div className="border-t border-gray-100" />
            <div className="max-h-64 overflow-y-auto">
              {customRoles.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400">
                  No roles yet. Create one in{' '}
                  <Link href="/admin/roles" className="text-blue-600 hover:underline">Roles &amp; Permissions</Link>.
                </div>
              ) : (
                customRoles.map(role => {
                  const isCurrent = role.id === currentRoleId
                  return (
                    <button key={role.id} onClick={() => handleCustomRoleChange(role.id)} disabled={changingRole}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-2 hover:bg-gray-50 disabled:opacity-50 ${isCurrent ? 'bg-blue-50/50' : ''}`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: role.color ?? '#6366f1' }} />
                        <span className={`text-sm truncate ${isCurrent ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>{role.title}</span>
                        <span className="text-xs text-gray-400 truncate">· {role.department}</span>
                      </span>
                      {isCurrent && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
            {currentRoleId && (
              <>
                <div className="border-t border-gray-100" />
                <button onClick={() => handleCustomRoleChange(null)} disabled={changingRole}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50 text-sm">
                  <X className="w-3.5 h-3.5" /> Remove role
                </button>
              </>
            )}
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
  const [status,     setStatus]     = useState('')
  const [page,       setPage]       = useState(1)
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [permModalOpen, setPermModalOpen] = useState(false)
  const [permEmployee,  setPermEmployee]  = useState(null)
  const [customRoles,  setCustomRoles]  = useState([])
  const [ventures,     setVentures]     = useState([])
  const [departments,  setDepartments]  = useState([])
  const [deptModalOpen, setDeptModalOpen] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page, limit: 20 })
      if (search)     p.set('search',     search)
      if (department) p.set('department', department)
      if (year)       p.set('year',       year)
      if (sortBy)     p.set('sortBy',     sortBy)
      if (status)     p.set('status',     status)
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
  }, [page, search, department, year, sortBy, status])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/custom-roles')
      .then(r => r.json())
      .then(j => setCustomRoles(j.data ?? []))
      .catch(() => {})
  }, [])

  function loadDepartments() {
    fetch('/api/departments')
      .then(r => r.json())
      .then(j => setDepartments(j.data ?? []))
      .catch(() => {})
  }

  useEffect(() => { loadDepartments() }, [])

  useEffect(() => {
    if (!modalOpen) return
    fetch('/api/config')
      .then(r => r.json())
      .then(j => setVentures((j.data?.ventures ?? []).filter(v => v.active !== false)))
      .catch(() => {})
  }, [modalOpen])

  function handleSaved(emp, tempPw) {
    if (tempPw) toast.success(`Employee added! Temp password: ${tempPw}`, { duration: 8000 })
    else        toast.success(editing ? 'Employee updated' : 'Employee added')
    setEditing(null)
    load()
  }

  function handleResigned(id) {
    setEmployees(p => p.map(e => e.id !== id ? e : {
      ...e,
      resigned: true,
      resignDate: new Date().toISOString(),
      panelAccessGranted: false,
      userId: { ...e.userId, isActive: false },
    }))
  }

  function handleCustomRoleChanged(id, customRole) {
    setEmployees(p => p.map(e => e.id !== id ? e : { ...e, customRoleId: customRole }))
  }

  function handlePermissionsSaved(id, overrides) {
    setEmployees(p => p.map(e => e.id !== id ? e : { ...e, permissionOverrides: overrides }))
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage team members, profiles and panel access</p>
        </div>
        <div className="flex items-center gap-2">
          <Can perm="hr.employees.update">
            <button onClick={() => setDeptModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Settings className="w-4 h-4" /> Departments
            </button>
          </Can>
          <Can perm="hr.employees.create">
            <button onClick={() => { setEditing(null); setModalOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
              <Plus className="w-4 h-4" /> Add Employee
            </button>
          </Can>
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
          options={departments.map(d => ({ value: d.shortCode, label: d.name }))}
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
        <Select value={status} onChange={v => { setStatus(v ?? ''); setPage(1) }}
          options={[
            { value: 'active',   label: 'Active' },
            { value: 'pending',  label: 'Pending verification' },
            { value: 'resigned', label: 'Resigned' },
          ]}
          placeholder="All Status"
          className="w-44"
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
                  <tr key={emp.id} className={`hover:bg-gray-50/60 transition-colors group${emp.resigned ? ' opacity-60' : ''}`}>
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
                      {emp.resigned ? (
                        <span className="inline-flex items-center gap-1 text-xs text-orange-600">
                          <LogOut className="w-3.5 h-3.5" /> Resigned
                        </span>
                      ) : emp.panelAccessGranted ? (
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
                        customRoles={customRoles}
                        onEdit={e => { setEditing(e); setModalOpen(true) }}
                        onResigned={handleResigned}
                        onCustomRoleChanged={handleCustomRoleChanged}
                        onEditPermissions={e => { setPermEmployee(e); setPermModalOpen(true) }}
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
        departments={departments}
      />

      <ManageDepartmentsModal
        open={deptModalOpen}
        onClose={() => setDeptModalOpen(false)}
        departments={departments}
        onChanged={loadDepartments}
      />

      <EmployeePermissionsModal
        open={permModalOpen}
        onClose={() => { setPermModalOpen(false); setPermEmployee(null) }}
        employee={permEmployee}
        customRoles={customRoles}
        onSaved={handlePermissionsSaved}
      />

    </div>
  )
}
