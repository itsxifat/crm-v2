'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, Loader2, MapPin, CornerDownRight } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import { LOCATION_TYPE_OPTIONS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import { fetchJson, errorText } from '../../reports/_components/format'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'

const EMPTY = { name: '', code: '', type: 'OFFICE', parentId: '', address: '', notes: '', isActive: true }

/** Ids of a location and everything below it (it cannot become its own descendant's child). */
function subtreeIds(all, rootId) {
  const out = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const l of all) if (l.parentId && out.has(l.parentId) && !out.has(l.id)) { out.add(l.id); grew = true }
  }
  return out
}

function LocationModal({ open, onOpenChange, location, all, onSaved }) {
  const editing = Boolean(location)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(location ? {
      name: location.name,
      code: location.code ?? '',
      type: location.type,
      parentId: location.parentId ?? '',
      address: location.address ?? '',
      notes: location.notes ?? '',
      isActive: location.isActive,
    } : EMPTY)
  }, [open, location])

  const blocked = useMemo(() => (location ? subtreeIds(all, location.id) : new Set()), [all, location])
  const parents = all.filter(l => !blocked.has(l.id) && (l.isActive || l.id === form.parentId))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name.trim()) { toast.error('Enter a location name'); return }
    const code = form.code.trim().toUpperCase()
    if (code && !/^[A-Z0-9][A-Z0-9_-]{0,11}$/.test(code)) { toast.error('Code: up to 12 letters, digits, - or _'); return }
    setSaving(true)
    try {
      await fetchJson(editing ? `/api/inventory/locations/${location.id}` : '/api/inventory/locations', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          code: code || null,
          type: form.type,
          parentId: form.parentId || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
          isActive: form.isActive,
        }),
      })
      toast.success(editing ? 'Location updated' : 'Location added')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${location.name}` : 'New location'}
      description="Offices, floors, rooms and stores where assets are kept" size="md">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={form.name} maxLength={100} onChange={e => set('name', e.target.value)} placeholder="e.g. 2nd floor — design studio" />
          </div>
          <div>
            <label className={labelCls}>Code</label>
            <input className={cn(inputCls, 'font-mono uppercase')} value={form.code} maxLength={12}
              onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="HQ-2F" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={form.type} onChange={e => set('type', e.target.value)}>
              {LOCATION_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Inside</label>
            <select className={inputCls} value={form.parentId} onChange={e => set('parentId', e.target.value)}>
              <option value="">— Top level —</option>
              {parents.map(l => <option key={l.id} value={l.id}>{'  '.repeat(l.depth || 0)}{l.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Address</label>
          <input className={inputCls} value={form.address} maxLength={300} onChange={e => set('address', e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea className={inputCls} rows={2} value={form.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="rounded border-gray-300" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
          Active
        </label>
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
        <button className={btnGhost} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing ? 'Save changes' : 'Add location'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

export default function LocationsTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showInactive, setShowInactive] = useState(false)
  const [modal, setModal] = useState({ open: false, location: null })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson('/api/inventory/locations?withCounts=1')
      setRows(json.data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const visible = rows.filter(r => showInactive || r.isActive)
  const inactiveCount = rows.filter(r => !r.isActive).length

  async function toggleActive(l) {
    try {
      await fetchJson(`/api/inventory/locations/${l.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !l.isActive }),
      })
      toast.success(l.isActive ? `${l.name} deactivated` : `${l.name} reactivated`)
      load()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  async function remove(l) {
    if (!window.confirm(`Delete "${l.name}"? If anything refers to it, it will be deactivated instead.`)) return
    try {
      const json = await fetchJson(`/api/inventory/locations/${l.id}`, { method: 'DELETE' })
      toast.success(json.deactivated ? (json.message || 'Deactivated') : 'Location deleted')
      load()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-500">Codes make imports and labels easier (e.g. HQ, HQ-2F, STORE).</p>
        <div className="flex items-center gap-3">
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" className="rounded border-gray-300" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show inactive ({inactiveCount})
            </label>
          )}
          <button className={btnPrimary} onClick={() => setModal({ open: true, location: null })}>
            <Plus className="w-4 h-4" /> New location
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {error ? (
          <EmptyState title="Couldn't load locations" description={error} action={<button className={btnPrimary} onClick={load}>Try again</button>} />
        ) : loading && !rows.length ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : visible.length === 0 ? (
          <EmptyState icon={MapPin} title="No locations yet" description="Add your office, floors, rooms and store so every asset has a place."
            action={<button className={btnPrimary} onClick={() => setModal({ open: true, location: null })}><Plus className="w-4 h-4" /> New location</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Location</th>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3 hidden md:table-cell">Address</th>
                  <th className="px-3 py-3 text-right">Assets</th>
                  <th className="px-3 py-3 text-right">Stock items</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map(l => (
                  <tr key={l.id} className={cn('hover:bg-gray-50/60', !l.isActive && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5" style={{ paddingLeft: `${(l.depth || 0) * 16}px` }}>
                        {l.depth > 0 && <CornerDownRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
                        <span className="font-medium text-gray-900">{l.name}</span>
                        {!l.isActive && <span className="text-xs text-gray-400">(inactive)</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">{l.code ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-3 text-gray-700">{l.typeLabel}</td>
                    <td className="px-3 py-3 text-gray-500 hidden md:table-cell max-w-[260px] truncate">{l.address ?? ''}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{l.heldCount ?? 0}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{l.stockItemCount ?? 0}</td>
                    <td className="px-3 py-3 text-right">
                      <ActionMenu items={[
                        { label: 'Edit', icon: Pencil, onClick: () => setModal({ open: true, location: l }) },
                        { label: l.isActive ? 'Deactivate' : 'Reactivate', icon: l.isActive ? Archive : ArchiveRestore, onClick: () => toggleActive(l) },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(l) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LocationModal open={modal.open} location={modal.location} all={rows}
        onOpenChange={o => setModal(m => ({ ...m, open: o }))} onSaved={load} />
    </div>
  )
}
