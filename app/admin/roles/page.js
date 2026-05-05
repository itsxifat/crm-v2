'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Pencil, Trash2, X, Loader2, ShieldCheck,
  Search, ChevronDown, ChevronRight,
  LayoutDashboard, TrendingUp, Briefcase, Wallet, Users, BarChart2, Settings2, CircleUser,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Select from '@/components/ui/Select'
import { PERMISSION_MODULES, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@/lib/rbac'
import { useConfig } from '@/lib/useConfig'

// ─── Module metadata ──────────────────────────────────────────────────────────

const MODULE_META = {
  dashboard: { Icon: LayoutDashboard, ring: 'ring-indigo-200',  bg: 'bg-indigo-50',  text: 'text-indigo-600',  bar: 'bg-indigo-500' },
  sales:     { Icon: TrendingUp,      ring: 'ring-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-600', bar: 'bg-emerald-500' },
  projects:  { Icon: Briefcase,       ring: 'ring-blue-200',    bg: 'bg-blue-50',    text: 'text-blue-600',    bar: 'bg-blue-500' },
  finance:   { Icon: Wallet,          ring: 'ring-amber-200',   bg: 'bg-amber-50',   text: 'text-amber-600',   bar: 'bg-amber-500' },
  hr:        { Icon: Users,           ring: 'ring-violet-200',  bg: 'bg-violet-50',  text: 'text-violet-600',  bar: 'bg-violet-500' },
  analytics: { Icon: BarChart2,       ring: 'ring-pink-200',    bg: 'bg-pink-50',    text: 'text-pink-600',    bar: 'bg-pink-500' },
  system:    { Icon: Settings2,       ring: 'ring-slate-200',   bg: 'bg-slate-50',   text: 'text-slate-600',   bar: 'bg-slate-500' },
  account:   { Icon: CircleUser,      ring: 'ring-teal-200',    bg: 'bg-teal-50',    text: 'text-teal-600',    bar: 'bg-teal-500' },
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b']

const PRESETS = [
  { label: 'Manager',  key: 'MANAGER',  color: 'text-violet-700 bg-violet-50 hover:bg-violet-100 border-violet-200' },
  { label: 'Employee', key: 'EMPLOYEE', color: 'text-blue-700 bg-blue-50 hover:bg-blue-100 border-blue-200' },
  { label: 'Grant All', key: '__ALL__', color: 'text-green-700 bg-green-50 hover:bg-green-100 border-green-200' },
  { label: 'Clear All', key: '__NONE__', color: 'text-red-600 bg-red-50 hover:bg-red-100 border-red-200' },
]

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-blue-600' : 'bg-gray-200'
      }`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-150 ${
        checked ? 'translate-x-4' : 'translate-x-0'
      }`} />
    </button>
  )
}

// ─── Role Modal ────────────────────────────────────────────────────────────────

function RoleModal({ open, onClose, role, onSaved, ventureOptions, departments }) {
  const isEdit = !!role
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ department: '', title: '', description: '', venture: '', color: '#6366f1' })

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
      onSaved(json.data)
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (!open) return null
  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
  const lc = 'block text-xs font-medium text-gray-500 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-900">{isEdit ? 'Edit Role' : 'New Role'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className={lc}>Department *</label>
            <input list="dept-list" value={form.department} onChange={e => set('department', e.target.value)} placeholder="e.g. Engineering" className={ic} required />
            <datalist id="dept-list">{(departments ?? []).map(d => <option key={d.id ?? d} value={d.name ?? d} />)}</datalist>
          </div>
          <div>
            <label className={lc}>Role Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Senior Designer" className={ic} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>Venture</label>
              <Select value={form.venture} onChange={v => set('venture', v ?? '')} options={ventureOptions ?? []} placeholder="All Ventures" />
            </div>
            <div>
              <label className={lc}>Badge Color</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => set('color', c)} style={{ background: c }}
                    className={`w-5 h-5 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : 'hover:scale-110'}`} />
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
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2 transition-colors">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Module Card ────────────────────────────────────────────────────────────────

function ModuleCard({ module, activePerms, onToggle, onToggleAll, saving, searchQuery }) {
  const [expanded, setExpanded] = useState(true)
  const meta = MODULE_META[module.key] ?? MODULE_META.system
  const { Icon, bg, text, bar } = meta

  const filteredPerms = useMemo(() => {
    if (!searchQuery) return module.permissions
    const q = searchQuery.toLowerCase()
    return module.permissions.filter(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
  }, [module.permissions, searchQuery])

  // If searching and no results, hide the card
  if (searchQuery && filteredPerms.length === 0) return null

  const modulePerms  = module.permissions.map(p => p.key)
  const enabledCount = modulePerms.filter(k => activePerms.has(k)).length
  const allEnabled   = enabledCount === modulePerms.length
  const pct          = modulePerms.length > 0 ? Math.round((enabledCount / modulePerms.length) * 100) : 0

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      {/* Module header */}
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 ${expanded ? '' : ''}`}>
        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${text}`} />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider truncate">
            {module.label}
          </span>
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          }
        </button>
        <span className="text-xs font-medium text-gray-500 shrink-0">{enabledCount}/{modulePerms.length}</span>
        <button
          type="button"
          disabled={saving}
          onClick={() => onToggleAll(modulePerms, !allEnabled)}
          className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors shrink-0 border ${
            allEnabled
              ? 'text-red-600 border-red-100 hover:bg-red-50'
              : 'text-blue-600 border-blue-100 hover:bg-blue-50'
          }`}
        >
          {allEnabled ? 'Remove all' : 'Grant all'}
        </button>
      </div>

      {/* Mini progress bar */}
      <div className="h-0.5 bg-gray-100">
        <div className={`h-full ${bar} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>

      {/* Permissions list */}
      {expanded && (
        <div className="divide-y divide-gray-50">
          {filteredPerms.map(perm => {
            const enabled = activePerms.has(perm.key)
            return (
              <div
                key={perm.key}
                className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors cursor-pointer hover:bg-gray-50 ${
                  enabled ? '' : 'opacity-60'
                }`}
                onClick={() => !saving && onToggle(perm.key, !enabled)}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${enabled ? 'text-gray-800' : 'text-gray-500'}`}>
                    {perm.label}
                  </p>
                  <p className="text-xs text-gray-300 font-mono mt-0.5 truncate">{perm.key}</p>
                </div>
                <Toggle
                  checked={enabled}
                  onChange={val => onToggle(perm.key, val)}
                  disabled={saving}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const [roles,       setRoles]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState(null)
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editingRole, setEditingRole] = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [search,      setSearch]      = useState('')
  const [activePerms, setActivePerms] = useState(new Set())
  const [departments, setDepartments] = useState([])

  const { ventureOptions } = useConfig()

  useEffect(() => {
    fetch('/api/departments')
      .then(r => r.json())
      .then(j => setDepartments(j.data ?? []))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/custom-roles')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const data = json.data ?? []
      setRoles(data)
      if (data.length > 0) {
        const first = data[0]
        setSelected(first.id)
        setActivePerms(new Set(first.permissions ?? []))
      }
    } catch { toast.error('Failed to load roles') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const role = roles.find(r => r.id === selected)
    setActivePerms(new Set(role?.permissions ?? []))
  }, [selected, roles])

  function handleSaved(role) {
    setRoles(prev => {
      const idx = prev.findIndex(r => r.id === role.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = role; return n }
      return [...prev, role]
    })
    setSelected(role.id)
    setActivePerms(new Set(role.permissions ?? []))
  }

  async function handleDelete(role) {
    if (!confirm(`Delete role "${role.title}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/custom-roles/${role.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Role deleted')
      const next = roles.filter(r => r.id !== role.id)
      setRoles(next)
      const fallback = next[0] ?? null
      setSelected(fallback?.id ?? null)
      setActivePerms(new Set(fallback?.permissions ?? []))
    } catch (err) { toast.error(err.message) }
  }

  async function persistPerms(roleId, newPermsArray) {
    setSaving(true)
    try {
      const res = await fetch(`/api/custom-roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: newPermsArray }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save')
      setRoles(prev => prev.map(r => r.id !== roleId ? r : { ...r, permissions: newPermsArray }))
    } catch (err) {
      toast.error(err.message)
      const snapshot = roles.find(r => r.id === roleId)
      setActivePerms(new Set(snapshot?.permissions ?? []))
    } finally { setSaving(false) }
  }

  function handleToggle(permKey, value) {
    if (!selected) return
    const next = new Set(activePerms)
    if (value) next.add(permKey); else next.delete(permKey)
    setActivePerms(next)
    persistPerms(selected, [...next])
  }

  function handleToggleAll(permKeys, value) {
    if (!selected) return
    const next = new Set(activePerms)
    permKeys.forEach(k => value ? next.add(k) : next.delete(k))
    setActivePerms(next)
    persistPerms(selected, [...next])
  }

  function handlePreset(key) {
    if (!selected) return
    let perms
    if (key === '__ALL__') {
      if (!confirm('Grant all permissions to this role?')) return
      perms = ALL_PERMISSIONS
    } else if (key === '__NONE__') {
      if (!confirm('Remove all permissions from this role?')) return
      perms = []
    } else {
      if (!confirm(`Apply the default "${key}" preset? This will replace current permissions.`)) return
      perms = DEFAULT_ROLE_PERMISSIONS[key] ?? []
    }
    const next = new Set(perms)
    setActivePerms(next)
    persistPerms(selected, perms)
  }

  const activeRole   = roles.find(r => r.id === selected)
  const totalEnabled = activePerms.size
  const pct          = ALL_PERMISSIONS.length > 0 ? Math.round((totalEnabled / ALL_PERMISSIONS.length) * 100) : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Roles & Permissions</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage roles and configure granular feature access</p>
        </div>
        <button
          onClick={() => { setEditingRole(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Role
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
          <button
            onClick={() => { setEditingRole(null); setModalOpen(true) }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Role
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5">

          {/* ── Left: Role List ─────────────────────────────────────────────── */}
          <div className="lg:w-64 shrink-0">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden sticky top-4 shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0">Roles</p>
                <p className="text-xs text-gray-400 mt-0.5">{roles.length} total</p>
              </div>
              <div className="divide-y divide-gray-50">
                {roles.map(role => {
                  const isActive = selected === role.id
                  const permCount = (role.permissions ?? []).length
                  return (
                    <div
                      key={role.id}
                      className={`group relative flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                        isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelected(role.id)}
                    >
                      {/* Color dot */}
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white"
                        style={{ background: role.color ?? '#6366f1' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isActive ? 'text-blue-700' : 'text-gray-700'}`}>
                          {role.title}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{role.department}</p>
                      </div>
                      {/* Permission count badge */}
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${
                        isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                      }`}>
                        {permCount}
                      </span>
                      {/* Hover actions */}
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-white border border-gray-100 rounded-lg shadow-sm px-1 py-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); setEditingRole(role); setModalOpen(true) }}
                          className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Edit role"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(role) }}
                          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete role"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Right: Permission Panel ─────────────────────────────────────── */}
          {activeRole && (
            <div className="flex-1 min-w-0 space-y-4">

              {/* Role header */}
              <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full ring-4 ring-white shadow-sm shrink-0" style={{ background: activeRole.color ?? '#6366f1' }} />
                    <div>
                      <p className="text-base font-semibold text-gray-900">{activeRole.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {activeRole.department}{activeRole.venture ? ` · ${activeRole.venture}` : ''}
                        {activeRole.description ? ` — ${activeRole.description}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => { setEditingRole(activeRole); setModalOpen(true) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(activeRole)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 border border-red-100 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-gray-500">
                      {saving
                        ? <span className="flex items-center gap-1.5 text-amber-600"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
                        : <><span className="font-semibold text-gray-700">{totalEnabled}</span> of {ALL_PERMISSIONS.length} permissions enabled</>
                      }
                    </span>
                    <span className="text-xs font-semibold text-gray-500">{pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Presets + Search row */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-400 font-medium">Quick apply:</span>
                  {PRESETS.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      disabled={saving}
                      onClick={() => handlePreset(p.key)}
                      className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors disabled:opacity-50 ${p.color}`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <div className="ml-auto relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search permissions…"
                      className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-48"
                    />
                  </div>
                </div>
              </div>

              {/* Module cards */}
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {PERMISSION_MODULES.map(module => (
                  <ModuleCard
                    key={module.key}
                    module={module}
                    activePerms={activePerms}
                    onToggle={handleToggle}
                    onToggleAll={handleToggleAll}
                    saving={saving}
                    searchQuery={search}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <RoleModal open={modalOpen} onClose={() => setModalOpen(false)} role={editingRole} onSaved={handleSaved} ventureOptions={ventureOptions} departments={departments} />
    </div>
  )
}
