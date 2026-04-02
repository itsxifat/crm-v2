'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X, Loader2, ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Select from '@/components/ui/Select'

// ─── Config ───────────────────────────────────────────────────────────────────

const MODULES = [
  { key: 'dashboard',  label: 'Dashboard',           perms: [{ key: 'view', label: 'View' }, { key: 'viewStats', label: 'Statistics' }, { key: 'exportData', label: 'Export Data' }] },
  { key: 'projects',   label: 'Projects',            perms: [{ key: 'view', label: 'View' }, { key: 'create', label: 'Create' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }, { key: 'viewFinancials', label: 'Financials' }, { key: 'managePayments', label: 'Payments' }] },
  { key: 'clients',    label: 'Clients',             perms: [{ key: 'view', label: 'View' }, { key: 'create', label: 'Add' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }, { key: 'viewKYC', label: 'View KYC' }, { key: 'manageKYC', label: 'Manage KYC' }] },
  { key: 'invoices',   label: 'Invoices',            perms: [{ key: 'view', label: 'View' }, { key: 'create', label: 'Create' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }, { key: 'export', label: 'Export' }] },
  { key: 'employees',  label: 'Employees',           perms: [{ key: 'view', label: 'View' }, { key: 'create', label: 'Add' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }] },
  { key: 'accounts',   label: 'Accounts',            perms: [{ key: 'view', label: 'View' }, { key: 'addTransaction', label: 'Transactions' }, { key: 'exportReports', label: 'Export' }] },
  { key: 'leads',      label: 'Leads',               perms: [{ key: 'view', label: 'View' }, { key: 'create', label: 'Create' }, { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }] },
  { key: 'roles',      label: 'Roles & Permissions', perms: [{ key: 'view', label: 'View' }, { key: 'manage', label: 'Manage' }] },
]

const VENTURES    = [{ value: '', label: 'All Ventures' }, { value: 'ENTECH', label: 'EnTech' }, { value: 'ENSTUDIO', label: 'EnStudio' }, { value: 'ENMARK', label: 'EnMark' }]
const COLORS      = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b']
const DEPARTMENTS = ['Management','Engineering','Design','Finance','HR','Marketing','Operations','Sales','Legal','Other']

function getPerm(permissions, mod, perm) { return permissions?.[mod]?.[perm] ?? false }

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full group py-1.5"
    >
      <span className={`text-sm transition-colors ${checked ? 'text-gray-800' : 'text-gray-400'}`}>{label}</span>
      <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-blue-500' : 'bg-gray-200'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
    </button>
  )
}

// ─── Role Modal ────────────────────────────────────────────────────────────────

function RoleModal({ open, onClose, role, onSaved }) {
  const isEdit = !!role
  const [saving, setSaving] = useState(false)
  const [form, setForm]     = useState({ department: '', title: '', description: '', venture: '', color: '#6366f1' })

  useEffect(() => {
    if (!open) return
    setForm(isEdit
      ? { department: role.department ?? '', title: role.title ?? '', description: role.description ?? '', venture: role.venture ?? '', color: role.color ?? '#6366f1' }
      : { department: '', title: '', description: '', venture: '', color: '#6366f1' }
    )
  }, [open, role, isEdit])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.department.trim() || !form.title.trim()) { toast.error('Department and title are required'); return }
    setSaving(true)
    try {
      const res  = await fetch(isEdit ? `/api/custom-roles/${role.id}` : '/api/custom-roles', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(isEdit ? 'Role updated' : 'Role created')
      onSaved(json.data); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (!open) return null
  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'
  const lc = 'block text-xs font-medium text-gray-500 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{isEdit ? 'Edit Role' : 'New Role'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label className={lc}>Department *</label>
            <input list="dept-list" value={form.department} onChange={e => set('department', e.target.value)} placeholder="e.g. Engineering" className={ic} required />
            <datalist id="dept-list">{DEPARTMENTS.map(d => <option key={d} value={d} />)}</datalist>
          </div>
          <div>
            <label className={lc}>Role Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Senior Designer" className={ic} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Venture</label>
              <Select value={form.venture} onChange={v => set('venture', v ?? '')}
                options={VENTURES.filter(v => v.value !== '').map(v => ({ value: v.value, label: v.label }))}
                placeholder="All Ventures"
              />
            </div>
            <div>
              <label className={lc}>Color</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => set('color', c)} style={{ background: c }}
                    className={`w-5 h-5 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-1 ring-gray-300 scale-110' : ''}`} />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className={lc}>Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Optional" className={`${ic} resize-none`} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const [roles,        setRoles]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selected,     setSelected]     = useState(null) // selected role id
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editingRole,  setEditingRole]  = useState(null)

  async function load() {
    try {
      const res  = await fetch('/api/custom-roles')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const data = json.data ?? []
      setRoles(data)
      if (data.length > 0 && !selected) setSelected(data[0].id)
    } catch { toast.error('Failed to load roles') }
    finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  function handleSaved(role) {
    setRoles(prev => {
      const idx = prev.findIndex(r => r.id === role.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = role; return n }
      return [...prev, role]
    })
    setSelected(role.id)
  }

  async function handleDelete(role) {
    if (!confirm(`Delete "${role.title}"?`)) return
    try {
      const res = await fetch(`/api/custom-roles/${role.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Role deleted')
      const next = roles.filter(r => r.id !== role.id)
      setRoles(next)
      setSelected(next[0]?.id ?? null)
    } catch (err) { toast.error(err.message) }
  }

  async function handlePermChange(roleId, mod, perm, value) {
    const snapshot = roles.find(r => r.id === roleId)
    setRoles(prev => prev.map(r => r.id !== roleId ? r : {
      ...r, permissions: { ...r.permissions, [mod]: { ...(r.permissions?.[mod] ?? {}), [perm]: value } },
    }))
    try {
      const updatedPerms = { ...(snapshot.permissions ?? {}), [mod]: { ...(snapshot.permissions?.[mod] ?? {}), [perm]: value } }
      const res = await fetch(`/api/custom-roles/${roleId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions: updatedPerms }) })
      if (!res.ok) throw new Error((await res.json()).error)
    } catch {
      toast.error('Failed to save')
      setRoles(prev => prev.map(r => r.id !== roleId ? r : {
        ...r, permissions: { ...r.permissions, [mod]: { ...(r.permissions?.[mod] ?? {}), [perm]: !value } },
      }))
    }
  }

  const activeRole = roles.find(r => r.id === selected)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Roles & Permissions</h1>
          <p className="text-sm text-gray-400 mt-0.5">Create roles and configure feature access</p>
        </div>
        <button onClick={() => { setEditingRole(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add Role
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : roles.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-100">
          <ShieldCheck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No roles yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Add a role to start configuring permissions</p>
          <button onClick={() => { setEditingRole(null); setModalOpen(true) }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Role
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">

          {/* ── Role list (left panel) ── */}
          <div className="lg:w-56 shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <p className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">Roles</p>
              <div className="divide-y divide-gray-50">
                {roles.map(role => (
                  <button
                    key={role.id}
                    onClick={() => setSelected(role.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${selected === role.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: role.color ?? '#6366f1' }} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${selected === role.id ? 'text-blue-700' : 'text-gray-700'}`}>{role.title}</p>
                      <p className="text-xs text-gray-400 truncate">{role.department}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Permission panel (right) ── */}
          {activeRole && (
            <div className="flex-1 min-w-0">
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* Role header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: activeRole.color ?? '#6366f1' }} />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{activeRole.title}</p>
                      <p className="text-xs text-gray-400">{activeRole.department}{activeRole.venture ? ` · ${activeRole.venture}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setEditingRole(activeRole); setModalOpen(true) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(activeRole)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 border border-red-100 rounded-lg hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>

                {/* Permissions grid */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-px bg-gray-100">
                  {MODULES.map(module => (
                    <div key={module.key} className="bg-white p-4 space-y-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{module.label}</p>
                      {module.perms.map(p => (
                        <Toggle
                          key={p.key}
                          label={p.label}
                          checked={getPerm(activeRole.permissions, module.key, p.key)}
                          onChange={val => handlePermChange(activeRole.id, module.key, p.key, val)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <RoleModal open={modalOpen} onClose={() => setModalOpen(false)} role={editingRole} onSaved={handleSaved} />
    </div>
  )
}
