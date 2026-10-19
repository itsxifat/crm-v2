'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Select from '@/components/ui/Select'
import {
  Plus, MoreHorizontal, Eye, Pencil, Users,
  Briefcase, Clock, Building2, Shield, Download,
  FileText, X, Loader2, LogOut, Settings, Trash2, Check,
  SlidersHorizontal, RotateCcw, ChevronDown, ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import TkAmt from '@/components/ui/TkAmt'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Label, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import StatsCard from '@/components/ui/StatsCard'
import SearchInput from '@/components/ui/SearchInput'
import EmptyState from '@/components/ui/EmptyState'
import Pagination from '@/components/ui/Pagination'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { Can, usePermission } from '@/components/auth/Can'
import {
  PERMISSION_MODULES, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS,
  applyPermissionOverrides,
} from '@/lib/rbac'
import { TIN_REGEX } from '@/lib/tax/catalog'
import { cn } from '@/lib/utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// e-TIN: identity PII, masked ('••••••••9012') for viewers without pii.identity.view.
const isMaskedValue = (v) => typeof v === 'string' && v.includes('••')
const tinDigits     = (v) => String(v ?? '').replace(/[\s-]+/g, '')

// Auto-generate a short code from a department name (mirrors server logic)
function autoShortCode(name) {
  if (!name) return ''
  const words = name.trim().split(/[\s&\/\-_]+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').toUpperCase()
}

// rbac labels are Title Case — render them in sentence case, keeping acronyms (VAT, KYC…) and proper nouns.
const KEEP_CASE = new Set(['Mushak', 'bKash', 'Nagad'])
function sentenceCase(s = '') {
  return s
    .split(' ')
    .map((w, i) => (i > 0 && /^[A-Z][a-z]/.test(w) && !KEEP_CASE.has(w) ? w.toLowerCase() : w))
    .join(' ')
}

const ROLE_META = {
  SUPER_ADMIN: { label: 'Super admin', variant: 'danger'  },
  MANAGER:     { label: 'Manager',     variant: 'primary' },
  EMPLOYEE:    { label: 'Employee',    variant: 'default' },
  FREELANCER:  { label: 'Freelancer',  variant: 'purple'  },
  CLIENT:      { label: 'Client',      variant: 'success' },
  VENDOR:      { label: 'Vendor',      variant: 'orange'  },
}

function RoleBadge({ role }) {
  const m = ROLE_META[role] ?? { label: role, variant: 'default' }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

// Shared look for the hand-built dialogs below.
function DialogShell({ onBackdrop, className, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onBackdrop} />
      <div className={cn('relative flex w-full flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl', className)}>
        {children}
      </div>
    </div>
  )
}

function DialogHeader({ title, description, onClose }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close">
        <X />
      </Button>
    </div>
  )
}

const dialogFooter = 'flex items-center justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5'

// ─── Employee Modal ───────────────────────────────────────────────────────────

function EmployeeModal({ open, onClose, employee, onSaved, customRoles = [], ventures = [], departments = [] }) {
  const isEdit = !!employee
  const [saving, setSaving] = useState(false)
  // Assigning a custom role is role management (the API requires hr.roles.manage).
  const { can } = usePermission()
  const canManageRoles = can('hr.roles.manage')
  // The API only accepts a TIN from callers who may see it unmasked.
  const canEditTin = can('pii.identity.view')
  const initialTin = isEdit ? (employee.tin ?? '') : ''
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '',
    venture: '', department: '', position: '', designation: '', salary: '',
    hireDate: '', role: 'EMPLOYEE', customRoleId: '',
    bloodGroup: '', emergencyContact: '', address: '', nidNumber: '', tin: '',
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
        tin:                  employee.tin ?? '',
        appointmentLetterUrl: employee.appointmentLetterUrl ?? '',
        agreementUrl:         employee.agreementUrl ?? '',
        panelAccessGranted:   employee.panelAccessGranted ?? false,
      })
    } else {
      setForm({
        name: '', email: '', phone: '', password: '',
        venture: '', department: '', position: '', designation: '', salary: '',
        hireDate: '', role: 'EMPLOYEE', customRoleId: '',
        bloodGroup: '', emergencyContact: '', address: '', nidNumber: '', tin: '',
        appointmentLetterUrl: '', agreementUrl: '',
        panelAccessGranted: false,
      })
    }
  }, [open, employee, isEdit])

  // e-TIN (edit only): sent only when changed; a masked value is never sent back.
  const tinChanged  = isEdit && form.tin !== initialTin
  const tinMaskEdit = tinChanged && isMaskedValue(form.tin)
  const tinInvalid  = tinChanged && !tinMaskEdit && !!tinDigits(form.tin) && !TIN_REGEX.test(tinDigits(form.tin))

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (tinMaskEdit) { toast.error('Clear the hidden e-TIN fully, then type the full 12-digit e-TIN'); return }
    if (tinInvalid)  { toast.error('e-TIN must be 12 digits'); return }
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
        // A masked salary ('••••••') is sent back as-is so the server keeps the stored value.
        salary:               String(form.salary).includes('••') ? form.salary : (form.salary ? Number(form.salary) : null),
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
      // e-TIN: only a changed, unmasked value (blank clears it). Digits only.
      if (tinChanged && canEditTin) body.tin = tinDigits(form.tin) || null
      // Never round-trip masked display values (email, salary, address, NID…):
      // an untouched masked field is left out so the stored value is kept.
      if (isEdit) {
        for (const k of Object.keys(body)) {
          if (typeof body[k] === 'string' && body[k].includes('••')) delete body[k]
        }
      }

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

  const tinError = tinInvalid || tinMaskEdit
  const assignedRole = form.customRoleId ? customRoles.find(r => r.id === form.customRoleId) : null

  return (
    <DialogShell onBackdrop={onClose} className="max-h-[92vh] max-w-2xl">
      <DialogHeader
        title={isEdit ? 'Edit employee' : 'New employee'}
        description={isEdit ? `ID ${employee.employeeId}` : 'ID is auto-generated. Login details are emailed.'}
        onClose={onClose}
      />

      <form id="emp-form" onSubmit={handleSubmit} className="flex-1 space-y-6 overflow-y-auto px-6 pb-6 pt-2">
        {/* Personal */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Personal</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="emp-name" required>
              <Input id="emp-name" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Md. Hasan Ali" />
            </Field>
            <Field label="Email" htmlFor="emp-email" required>
              <Input id="emp-email" required type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@company.com" disabled={isEdit} />
            </Field>
            {isEdit && (
              <Field
                label="e-TIN"
                htmlFor="emp-tin"
                error={tinMaskEdit ? 'Clear the hidden e-TIN fully, then type the new one.'
                  : tinInvalid ? 'e-TIN must be 12 digits.'
                  : undefined}
                hint={!canEditTin ? 'You need identity access to change the e-TIN.'
                  : isMaskedValue(form.tin) ? 'Hidden for privacy. Leave as is, or replace it.'
                  : 'Printed on the salary TDS certificate (s.86).'}
              >
                <Input id="emp-tin" value={form.tin} onChange={e => set('tin', e.target.value)} inputMode="numeric"
                  placeholder="12 digits" disabled={!canEditTin} invalid={tinError}
                  className="font-mono" />
              </Field>
            )}
          </div>
        </section>

        {/* Employment */}
        <section className="space-y-3 border-t border-gray-100 pt-5">
          <h3 className="text-sm font-semibold text-gray-900">Employment</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Venture">
              <Select value={form.venture} onChange={v => set('venture', v ?? '')}
                options={ventures.map(v => ({ value: v.id, label: v.label }))}
                placeholder="All / not assigned"
              />
            </Field>
            <Field label="Department">
              <Select value={form.department} onChange={v => set('department', v ?? '')}
                options={departments.map(d => ({ value: d.shortCode, label: `${d.name} (${d.shortCode})` }))}
                placeholder="Not assigned"
              />
            </Field>
            <Field label="Position" htmlFor="emp-position">
              <Input id="emp-position" value={form.position} onChange={e => set('position', e.target.value)} placeholder="e.g. Senior Designer" />
            </Field>
            <Field label="Designation" htmlFor="emp-designation">
              <Input id="emp-designation" value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Creative Lead" />
            </Field>
            {canManageRoles && (
              <div>
                <Label>Role</Label>
                <Select value={form.customRoleId} onChange={v => set('customRoleId', v ?? '')}
                  options={customRoles.map(r => ({ value: r.id, label: `${r.title} · ${r.department}` }))}
                  placeholder="No role"
                />
                {assignedRole && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-block size-2 rounded-full" style={{ background: assignedRole.color ?? '#6366f1' }} />
                    Permissions come from {assignedRole.title}
                  </p>
                )}
              </div>
            )}
            <Field label="Monthly salary (৳)" htmlFor="emp-salary">
              <Input id="emp-salary" type="number" min="0" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Hire date" htmlFor="emp-hire">
              <Input id="emp-hire" type="date" value={form.hireDate} onChange={e => set('hireDate', e.target.value)} />
            </Field>
          </div>
        </section>
      </form>

      <div className={dialogFooter}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="emp-form" loading={saving}>
          {isEdit ? 'Save' : 'Add employee'}
        </Button>
      </div>
    </DialogShell>
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
    if (!confirm('Deactivate this department? Existing employees keep their current department code.')) return
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

  const close = () => { resetForm(); onClose() }

  return (
    <DialogShell onBackdrop={close} className="max-h-[90vh] max-w-lg">
      <DialogHeader title="Departments" onClose={close} />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6 pt-2">
        {/* Add / Edit form */}
        <form onSubmit={handleSave} className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">
            {editing ? 'Edit department' : 'New department'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" htmlFor="dept-name" required className="col-span-2">
              <Input
                id="dept-name"
                required
                value={form.name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. Human Resources"
              />
            </Field>
            <Field label="Short code" htmlFor="dept-code" required hint="Used in employee IDs">
              <Input
                id="dept-code"
                required
                value={form.shortCode}
                onChange={e => handleCodeChange(e.target.value)}
                placeholder="e.g. HR"
                maxLength={6}
                className="font-mono uppercase"
              />
            </Field>
            <Field label="Description" htmlFor="dept-desc">
              <Input
                id="dept-desc"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={saving}>
              {editing ? 'Save' : 'Add department'}
            </Button>
            {editing && (
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
            )}
          </div>
        </form>

        {/* Departments list */}
        {departments.length > 0 && (
          <div className="space-y-2 border-t border-gray-100 pt-5">
            <h3 className="text-sm font-semibold text-gray-900">Existing departments</h3>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
              {departments.map(dept => (
                <div key={dept.id}
                  className={cn('flex items-center justify-between px-3 py-2.5', editing?.id === dept.id && 'bg-gray-50')}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-600">
                      {dept.shortCode}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{dept.name}</p>
                      {dept.description && <p className="truncate text-xs text-muted-foreground">{dept.description}</p>}
                    </div>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon-xs" onClick={() => startEdit(dept)} title="Edit" aria-label="Edit">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(dept.id)} disabled={deleting === dept.id}
                      title="Deactivate" aria-label="Deactivate" className="hover:bg-red-50 hover:text-red-600">
                      {deleting === dept.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {departments.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No departments yet</p>
        )}
      </div>
    </DialogShell>
  )
}

// ─── Per-User Permissions Modal ───────────────────────────────────────────────

function PermToggle({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-gray-900' : 'bg-gray-200'
      )}>
      <span className={cn('pointer-events-none inline-block size-4 rounded-full bg-white shadow-xs transition-transform duration-150', checked ? 'translate-x-4' : 'translate-x-0')} />
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

  const sourceLabel = roleObj ? `${roleObj.title} · ${roleObj.department}` : `Default ${ROLE_META[baseRole]?.label?.toLowerCase() ?? baseRole} permissions`

  return (
    <DialogShell onBackdrop={onClose} className="max-h-[88vh] max-w-2xl">
      <DialogHeader
        title={`Permissions · ${employee.userId?.name ?? ''}`}
        description={`Baseline: ${sourceLabel}`}
        onClose={onClose}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 pb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search permissions…" debounceMs={0} className="min-w-40 flex-1" />
        <span className="text-xs text-muted-foreground" title="Anything different from the baseline role is saved as a personal override.">
          <span className="font-medium text-gray-900 tabular-nums">{active.size}</span> enabled
          {overrideCount > 0 && <> · <span className="font-medium text-amber-600 tabular-nums">{overrideCount}</span> customised</>}
        </span>
        <Button variant="outline" size="sm" onClick={() => setActive(new Set(baselineSet))} disabled={saving || overrideCount === 0}>
          <RotateCcw /> Reset to role
        </Button>
      </div>

      {/* Body */}
      <div className="space-y-3 overflow-y-auto px-6 py-4">
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
            <div key={module.key} className="overflow-hidden rounded-lg border border-gray-200/80">
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-3 py-1.5">
                <button type="button" onClick={() => toggleCollapse(module.key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none">
                  {isCollapsed ? <ChevronRight className="size-4 shrink-0 text-gray-400" /> : <ChevronDown className="size-4 shrink-0 text-gray-400" />}
                  <span className="truncate text-sm font-medium text-gray-900">{sentenceCase(module.label)}</span>
                </button>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{enabled}/{keys.length}</span>
                <Button variant="ghost" size="xs" disabled={saving} onClick={() => toggleModule(keys, !allOn)}
                  className={allOn ? 'text-red-600 hover:bg-red-50 hover:text-red-700' : ''}>
                  {allOn ? 'Remove all' : 'Grant all'}
                </Button>
              </div>
              {!isCollapsed && (
                <div className="divide-y divide-gray-100">
                  {perms.map(perm => {
                    const on = active.has(perm.key)
                    const overridden = on !== baselineSet.has(perm.key)
                    return (
                      <div key={perm.key} onClick={() => !saving && toggle(perm.key)}
                        className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50/70">
                        <div className="min-w-0">
                          <p className={cn('flex items-center gap-1.5 text-sm', on ? 'text-gray-900' : 'text-gray-500')}>
                            {sentenceCase(perm.label)}
                            {overridden && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Overridden for this person" />}
                          </p>
                          <p className="truncate font-mono text-xs text-gray-400">{perm.key}</p>
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

      <div className={dialogFooter}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>Save permissions</Button>
      </div>
    </DialogShell>
  )
}

// ─── Row Menu ─────────────────────────────────────────────────────────────────

const menuItem = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50'

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
    <div ref={ref} className="relative inline-block">
      <Button variant="ghost" size="icon-sm" className="text-gray-400" aria-label="Actions" data-open={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); setRoleMode(false) }}>
        <MoreHorizontal />
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-[9999] w-52 rounded-xl border border-gray-200/80 bg-white p-1 text-left shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
          {!roleMode ? (<>
            <Link href={`/admin/employees/${employee.id}`} className={menuItem}>
              <Eye className="size-4 opacity-60" /> View profile
            </Link>
            {canEdit && (
              <button onClick={() => { setOpen(false); onEdit(employee) }} className={menuItem}>
                <Pencil className="size-4 opacity-60" /> Edit
              </button>
            )}
            {canManageRoles && (
              <button onClick={() => setRoleMode(true)} className={menuItem}>
                <Shield className="size-4 opacity-60" /> Change role
              </button>
            )}
            {canManageRoles && (
              <button onClick={() => { setOpen(false); onEditPermissions(employee) }} className={menuItem}>
                <SlidersHorizontal className="size-4 opacity-60" /> Permissions
              </button>
            )}
            {employee.appointmentLetterUrl && (
              <a href={employee.appointmentLetterUrl} target="_blank" rel="noreferrer" className={menuItem}>
                <Download className="size-4 opacity-60" /> Appointment letter
              </a>
            )}
            {employee.agreementUrl && (
              <a href={employee.agreementUrl} target="_blank" rel="noreferrer" className={menuItem}>
                <FileText className="size-4 opacity-60" /> Agreement
              </a>
            )}
            {canEdit && <div className="-mx-1 my-1 h-px bg-gray-100" />}
            {canEdit && (employee.resigned ? (
              <span className="flex w-full cursor-default items-center gap-2 px-2 py-1.5 text-sm text-gray-400">
                <LogOut className="size-4" /> Already resigned
              </span>
            ) : (
              <button onClick={handleResign} disabled={resigning} className={cn(menuItem, 'text-red-600 hover:bg-red-50 hover:text-red-700')}>
                <LogOut className="size-4" /> Mark resigned
              </button>
            ))}
          </>) : (<>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Assign role</span>
              <Button variant="ghost" size="icon-xs" onClick={() => setRoleMode(false)} className="size-6 text-gray-400" aria-label="Back">
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="-mx-1 my-1 h-px bg-gray-100" />
            <div className="max-h-64 overflow-y-auto">
              {customRoles.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  No roles yet. Create one in{' '}
                  <Link href="/admin/roles" className="font-medium text-gray-900 underline-offset-4 hover:underline">Roles &amp; permissions</Link>.
                </div>
              ) : (
                customRoles.map(role => {
                  const isCurrent = role.id === currentRoleId
                  return (
                    <button key={role.id} onClick={() => handleCustomRoleChange(role.id)} disabled={changingRole}
                      className={cn(menuItem, 'justify-between', isCurrent && 'bg-gray-100')}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: role.color ?? '#6366f1' }} />
                        <span className={cn('truncate', isCurrent && 'font-medium text-gray-900')}>{role.title}</span>
                        <span className="truncate text-xs text-muted-foreground">· {role.department}</span>
                      </span>
                      {isCurrent && <Check className="size-4 shrink-0 text-gray-900" />}
                    </button>
                  )
                })
              )}
            </div>
            {currentRoleId && (
              <>
                <div className="-mx-1 my-1 h-px bg-gray-100" />
                <button onClick={() => handleCustomRoleChange(null)} disabled={changingRole}
                  className={cn(menuItem, 'text-red-600 hover:bg-red-50 hover:text-red-700')}>
                  <X className="size-4" /> Remove role
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

  // Only role managers can list/assign custom roles — skip the fetch otherwise.
  const { can: canPerm } = usePermission()
  const canListRoles = canPerm('hr.roles.manage')
  useEffect(() => {
    if (!canListRoles) return
    fetch('/api/custom-roles')
      .then(r => r.json())
      .then(j => setCustomRoles(j.data ?? []))
      .catch(() => {})
  }, [canListRoles])

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
    if (tempPw) toast.success(`Employee added. Temp password: ${tempPw}`, { duration: 8000 })
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
    { label: 'Total employees', value: stats.totalEmployees,  icon: Users },
    { label: 'Active tasks',    value: stats.activeTasks,     icon: Briefcase },
    { label: 'On leave today',  value: stats.onLeaveToday,    icon: Clock },
    { label: 'Departments',     value: stats.departmentCount, icon: Building2 },
  ] : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        actions={
          <>
            <Can perm="hr.employees.update">
              <Button variant="outline" onClick={() => setDeptModalOpen(true)}>
                <Settings /> Departments
              </Button>
            </Can>
            <Can perm="hr.employees.create">
              <Button onClick={() => { setEditing(null); setModalOpen(true) }}>
                <Plus /> New employee
              </Button>
            </Can>
          </>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STAT_CARDS.map(({ label, value, icon }) => (
            <StatsCard key={label} title={label} value={value ?? 0} icon={icon} />
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={v => { setSearch(v); setPage(1) }}
          placeholder="Search name, email, ID…"
          className="w-full sm:w-64"
        />
        <Select value={department} onChange={v => { setDepartment(v ?? ''); setPage(1) }}
          options={departments.map(d => ({ value: d.shortCode, label: d.name }))}
          placeholder="All departments"
          className="w-44"
        />
        <Select value={year} onChange={v => { setYear(v ?? ''); setPage(1) }}
          options={Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => ({ value: String(y), label: String(y) }))}
          placeholder="All years"
          className="w-28"
        />
        <Select value={status} onChange={v => { setStatus(v ?? ''); setPage(1) }}
          options={[
            { value: 'active',   label: 'Active' },
            { value: 'pending',  label: 'Pending verification' },
            { value: 'resigned', label: 'Resigned' },
          ]}
          placeholder="All statuses"
          className="w-44"
        />
        <Select value={sortBy} onChange={v => { setSortBy(v ?? ''); setPage(1) }}
          options={[{ value: 'employeeId', label: 'Sort: Employee ID' }]}
          placeholder="Sort: Newest first"
          className="w-44"
        />
        <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">{meta.total} employee{meta.total !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner size="md" />
          </div>
        ) : employees.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? 'No results' : 'No employees yet'}
            description={search ? 'Try a different search.' : undefined}
          />
        ) : (
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead className="text-right">Salary</TableHead>
                <TableHead>Hire date</TableHead>
                <TableHead>Tasks</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Panel</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map(emp => (
                <TableRow key={emp.id} className={cn('group', emp.resigned && 'opacity-60')}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar name={emp.userId?.name} src={emp.userId?.avatar} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/admin/employees/${emp.id}`} className="font-medium text-gray-900 underline-offset-4 hover:underline">
                          {emp.userId?.name ?? '—'}
                        </Link>
                        <p className="text-xs text-muted-foreground">{emp.userId?.email ?? ''}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                      {emp.employeeId ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>{emp.department ?? '—'}</TableCell>
                  <TableCell>
                    <p className="text-gray-900">{emp.designation || emp.position || '—'}</p>
                    {emp.designation && emp.position && (
                      <p className="text-xs text-muted-foreground">{emp.position}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right"><TkAmt value={emp.salary} /></TableCell>
                  <TableCell className="whitespace-nowrap text-gray-500 tabular-nums">{fmtDate(emp.hireDate)}</TableCell>
                  <TableCell className="whitespace-nowrap text-gray-500">{emp.activeTaskCount ?? 0} active</TableCell>
                  <TableCell>
                    <RoleBadge role={emp.userId?.role ?? 'EMPLOYEE'} />
                    {emp.customRoleId && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: emp.customRoleId.color ?? '#6366f1' }} />
                        <span className="max-w-[100px] truncate text-xs text-muted-foreground">{emp.customRoleId.title}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {emp.resigned ? (
                      <Badge variant="orange">Resigned</Badge>
                    ) : emp.panelAccessGranted ? (
                      <Badge variant="success" dot>Granted</Badge>
                    ) : (
                      <Badge variant="default" dot>Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {emp.appointmentLetterUrl && (
                        <a href={emp.appointmentLetterUrl} target="_blank" rel="noreferrer" title="Appointment letter"
                          className="inline-flex size-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
                          <FileText className="size-4" />
                        </a>
                      )}
                      {emp.agreementUrl && (
                        <a href={emp.agreementUrl} target="_blank" rel="noreferrer" title="Agreement"
                          className="inline-flex size-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
                          <Download className="size-4" />
                        </a>
                      )}
                      {!emp.appointmentLetterUrl && !emp.agreementUrl && (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-2 text-right" onClick={e => e.stopPropagation()}>
                    <RowMenu
                      employee={emp}
                      customRoles={customRoles}
                      onEdit={e => { setEditing(e); setModalOpen(true) }}
                      onResigned={handleResigned}
                      onCustomRoleChanged={handleCustomRoleChanged}
                      onEditPermissions={e => { setPermEmployee(e); setPermModalOpen(true) }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        {meta.pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination page={page} pages={meta.pages} total={meta.total} limit={20} onPageChange={setPage} />
          </div>
        )}
      </Card>

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
