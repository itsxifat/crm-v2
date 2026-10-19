'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, Loader2, MapPin, CornerDownRight } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { LOCATION_TYPE_OPTIONS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import { fetchJson, errorText } from '../../reports/_components/format'

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
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${location.name}` : 'New location'} size="md">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={form.name} maxLength={100} onChange={e => set('name', e.target.value)} placeholder="e.g. 2nd floor — design studio" />
          </Field>
          <Field label="Code">
            <Input className="font-mono uppercase" value={form.code} maxLength={12}
              onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="HQ-2F" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <NativeSelect value={form.type} onChange={e => set('type', e.target.value)}>
              {LOCATION_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Inside">
            <NativeSelect value={form.parentId} onChange={e => set('parentId', e.target.value)}>
              <option value="">Top level</option>
              {parents.map(l => <option key={l.id} value={l.id}>{'  '.repeat(l.depth || 0)}{l.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Address">
          <Input value={form.address} maxLength={300} onChange={e => set('address', e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <input type="checkbox" className="rounded border-gray-300" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
          Active
        </label>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving}>
          {editing ? 'Save changes' : 'Add location'}
        </Button>
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
    if (!window.confirm(`Delete "${l.name}"? If it's in use, it will be deactivated instead.`)) return
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
      <div className="flex flex-wrap items-center gap-2">
        {inactiveCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="rounded border-gray-300" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive ({inactiveCount})
          </label>
        )}
        <Button className="ml-auto" onClick={() => setModal({ open: true, location: null })}>
          <Plus /> New location
        </Button>
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Couldn't load locations" description={error} action={<Button variant="outline" onClick={load}>Try again</Button>} />
        ) : loading && !rows.length ? (
          <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
        ) : visible.length === 0 ? (
          <EmptyState icon={MapPin} title="No locations yet"
            action={<Button variant="outline" onClick={() => setModal({ open: true, location: null })}><Plus /> New location</Button>} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Address</TableHead>
                <TableHead className="text-right">Assets</TableHead>
                <TableHead className="text-right">Stock items</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(l => (
                <TableRow key={l.id} className={cn(!l.isActive && 'opacity-60')}>
                  <TableCell>
                    <div className="flex items-center gap-1.5" style={{ paddingLeft: `${(l.depth || 0) * 16}px` }}>
                      {l.depth > 0 && <CornerDownRight className="size-3.5 shrink-0 text-gray-300" />}
                      <span className="font-medium text-gray-900">{l.name}</span>
                      {!l.isActive && <span className="text-xs text-gray-400">(inactive)</span>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.code ?? <span className="text-gray-300">—</span>}</TableCell>
                  <TableCell>{l.typeLabel}</TableCell>
                  <TableCell className="hidden max-w-[260px] truncate text-muted-foreground md:table-cell">{l.address ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.heldCount ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.stockItemCount ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <ActionMenu items={[
                      { label: 'Edit', icon: Pencil, onClick: () => setModal({ open: true, location: l }) },
                      { label: l.isActive ? 'Deactivate' : 'Reactivate', icon: l.isActive ? Archive : ArchiveRestore, onClick: () => toggleActive(l) },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(l) },
                    ]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <LocationModal open={modal.open} location={modal.location} all={rows}
        onOpenChange={o => setModal(m => ({ ...m, open: o }))} onSaved={load} />
    </div>
  )
}
