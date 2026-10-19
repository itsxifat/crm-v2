'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Pencil, Trash2, Loader2, ShieldCheck,
  ChevronDown, ChevronRight,
  LayoutDashboard, TrendingUp, Briefcase, Wallet, Users, BarChart2, Settings2, CircleUser, EyeOff,
  Calculator, Package,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Textarea, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import SearchInput from '@/components/ui/SearchInput'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { PERMISSION_MODULES, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@/lib/rbac'
import { useConfig } from '@/lib/useConfig'
import { cn } from '@/lib/utils'

// ─── Module metadata ──────────────────────────────────────────────────────────

const MODULE_ICONS = {
  dashboard: LayoutDashboard,
  sales:     TrendingUp,
  projects:  Briefcase,
  finance:   Wallet,
  tax:       Calculator,
  inventory: Package,
  hr:        Users,
  analytics: BarChart2,
  system:    Settings2,
  pii:       EyeOff,
  account:   CircleUser,
}

// rbac labels are Title Case — render them in sentence case, keeping acronyms (VAT, KYC…) and proper nouns.
const KEEP_CASE = new Set(['Mushak', 'bKash', 'Nagad'])
function sentenceCase(s = '') {
  return s
    .split(' ')
    .map((w, i) => (i > 0 && /^[A-Z][a-z]/.test(w) && !KEEP_CASE.has(w) ? w.toLowerCase() : w))
    .join(' ')
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b']

const PRESETS = [
  { label: 'Manager',   key: 'MANAGER' },
  { label: 'Employee',  key: 'EMPLOYEE' },
  { label: 'Grant all', key: '__ALL__' },
  { label: 'Clear all', key: '__NONE__', danger: true },
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
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-gray-900' : 'bg-gray-200'
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block size-4 rounded-full bg-white shadow-xs transition-transform duration-150',
        checked ? 'translate-x-4' : 'translate-x-0'
      )} />
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

  return (
    <Modal open={open} onOpenChange={o => { if (!o) onClose() }} title={isEdit ? 'Edit role' : 'New role'} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Department" htmlFor="role-department" required>
          <Input id="role-department" list="dept-list" value={form.department} onChange={e => set('department', e.target.value)} placeholder="e.g. Engineering" required />
          <datalist id="dept-list">{(departments ?? []).map(d => <option key={d.id ?? d} value={d.name ?? d} />)}</datalist>
        </Field>
        <Field label="Role title" htmlFor="role-title" required>
          <Input id="role-title" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Senior Designer" required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Venture">
            <Select value={form.venture} onChange={v => set('venture', v ?? '')} options={ventureOptions ?? []} placeholder="All ventures" />
          </Field>
          <Field label="Badge colour">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => set('color', c)} style={{ background: c }}
                  aria-label={c}
                  className={cn('size-5 rounded-full transition-all', form.color === c ? 'ring-2 ring-gray-900 ring-offset-2' : 'hover:scale-110')} />
              ))}
            </div>
          </Field>
        </div>
        <Field label="Description" htmlFor="role-description">
          <Textarea id="role-description" value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Optional" className="min-h-0 resize-none" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Save' : 'Create role'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Module rows (one <tbody> per module) ─────────────────────────────────────

function ModuleRows({ module, activePerms, onToggle, onToggleAll, saving, searchQuery }) {
  const [expanded, setExpanded] = useState(true)
  const Icon = MODULE_ICONS[module.key] ?? Settings2

  const filteredPerms = useMemo(() => {
    if (!searchQuery) return module.permissions
    const q = searchQuery.toLowerCase()
    return module.permissions.filter(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
  }, [module.permissions, searchQuery])

  // If searching and no results, hide the module
  if (searchQuery && filteredPerms.length === 0) return null

  const modulePerms  = module.permissions.map(p => p.key)
  const enabledCount = modulePerms.filter(k => activePerms.has(k)).length
  const allEnabled   = enabledCount === modulePerms.length

  return (
    <tbody>
      {/* Module header */}
      <tr className="border-y border-gray-100 bg-gray-50/60">
        <td colSpan={3} className="px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
            >
              {expanded
                ? <ChevronDown className="size-4 shrink-0 text-gray-400" />
                : <ChevronRight className="size-4 shrink-0 text-gray-400" />
              }
              <Icon className="size-4 shrink-0 text-gray-500" />
              <span className="truncate text-sm font-medium text-gray-900">{sentenceCase(module.label)}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{enabledCount}/{modulePerms.length}</span>
            </button>
            <Button
              variant="ghost"
              size="xs"
              disabled={saving}
              onClick={() => onToggleAll(modulePerms, !allEnabled)}
              className={allEnabled ? 'text-red-600 hover:bg-red-50 hover:text-red-700' : ''}
            >
              {allEnabled ? 'Remove all' : 'Grant all'}
            </Button>
          </div>
        </td>
      </tr>

      {/* Permissions */}
      {expanded && filteredPerms.map(perm => {
        const enabled = activePerms.has(perm.key)
        return (
          <TableRow
            key={perm.key}
            className="cursor-pointer last:border-0"
            onClick={() => !saving && onToggle(perm.key, !enabled)}
          >
            <TableCell className={cn('py-2.5 pl-10', enabled ? 'text-gray-900' : 'text-gray-500')}>
              {sentenceCase(perm.label)}
            </TableCell>
            <TableCell className="hidden py-2.5 font-mono text-xs text-gray-400 sm:table-cell">{perm.key}</TableCell>
            <TableCell className="w-16 py-2.5 text-right">
              <Toggle
                checked={enabled}
                onChange={val => onToggle(perm.key, val)}
                disabled={saving}
              />
            </TableCell>
          </TableRow>
        )
      })}
    </tbody>
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
    if (!confirm(`Delete role "${role.title}"? This can't be undone.`)) return
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
      if (!confirm(`Apply the default "${key}" preset? This replaces the current permissions.`)) return
      perms = DEFAULT_ROLE_PERMISSIONS[key] ?? []
    }
    const next = new Set(perms)
    setActivePerms(next)
    persistPerms(selected, perms)
  }

  const activeRole   = roles.find(r => r.id === selected)
  const totalEnabled = activePerms.size
  const pct          = ALL_PERMISSIONS.length > 0 ? Math.round((totalEnabled / ALL_PERMISSIONS.length) * 100) : 0

  const openNew = () => { setEditingRole(null); setModalOpen(true) }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & permissions"
        actions={<Button onClick={openNew}><Plus /> New role</Button>}
      />

      {loading ? (
        <PageLoader />
      ) : roles.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="No roles yet"
            action={<Button variant="outline" onClick={openNew}><Plus /> New role</Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

          {/* ── Left: Role list ─────────────────────────────────────────────── */}
          <div className="shrink-0 lg:sticky lg:top-4 lg:w-64">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">Roles</p>
                <span className="text-xs text-muted-foreground tabular-nums">{roles.length}</span>
              </div>
              <div className="space-y-0.5 p-1.5">
                {roles.map(role => {
                  const isActive = selected === role.id
                  const permCount = (role.permissions ?? []).length
                  return (
                    <div
                      key={role.id}
                      className={cn(
                        'group relative flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 transition-colors',
                        isActive ? 'bg-gray-100' : 'hover:bg-gray-50'
                      )}
                      onClick={() => setSelected(role.id)}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: role.color ?? '#6366f1' }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-sm font-medium', isActive ? 'text-gray-900' : 'text-gray-700')}>
                          {role.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{role.department}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {permCount}
                      </span>
                      {/* Hover actions */}
                      <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-gray-200/80 bg-white p-0.5 shadow-xs group-hover:flex">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={e => { e.stopPropagation(); setEditingRole(role); setModalOpen(true) }}
                          title="Edit role"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={e => { e.stopPropagation(); handleDelete(role) }}
                          className="hover:bg-red-50 hover:text-red-600"
                          title="Delete role"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>

          {/* ── Right: Permission panel ─────────────────────────────────────── */}
          {activeRole && (
            <div className="min-w-0 flex-1 space-y-4">

              {/* Role header */}
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="size-3 shrink-0 rounded-full" style={{ background: activeRole.color ?? '#6366f1' }} />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-900">{activeRole.title}</p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {activeRole.department}{activeRole.venture ? ` · ${activeRole.venture}` : ''}
                        {activeRole.description ? ` — ${activeRole.description}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEditingRole(activeRole); setModalOpen(true) }}>
                      <Pencil /> Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(activeRole)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                      <Trash2 /> Delete
                    </Button>
                  </div>
                </div>

                {/* Progress */}
                <div className="mt-5">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    {saving
                      ? <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Saving…</span>
                      : <span><span className="font-medium text-gray-900 tabular-nums">{totalEnabled}</span> of {ALL_PERMISSIONS.length} permissions enabled</span>
                    }
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-gray-900 transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Presets + search */}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                  <span className="mr-1 text-xs text-muted-foreground">Presets</span>
                  {PRESETS.map(p => (
                    <Button
                      key={p.key}
                      variant="outline"
                      size="xs"
                      disabled={saving}
                      onClick={() => handlePreset(p.key)}
                      className={p.danger ? 'text-red-600 hover:bg-red-50 hover:text-red-700' : ''}
                    >
                      {p.label}
                    </Button>
                  ))}
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Search permissions…"
                    debounceMs={0}
                    className="w-full sm:ml-auto sm:w-56"
                  />
                </div>
              </Card>

              {/* Permission matrix */}
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Permission</TableHead>
                      <TableHead className="hidden sm:table-cell">Key</TableHead>
                      <TableHead className="w-16 text-right">Access</TableHead>
                    </TableRow>
                  </TableHeader>
                  {PERMISSION_MODULES.map(module => (
                    <ModuleRows
                      key={module.key}
                      module={module}
                      activePerms={activePerms}
                      onToggle={handleToggle}
                      onToggleAll={handleToggleAll}
                      saving={saving}
                      searchQuery={search}
                    />
                  ))}
                </Table>
              </Card>
            </div>
          )}
        </div>
      )}

      <RoleModal open={modalOpen} onClose={() => setModalOpen(false)} role={editingRole} onSaved={handleSaved} ventureOptions={ventureOptions} departments={departments} />
    </div>
  )
}
