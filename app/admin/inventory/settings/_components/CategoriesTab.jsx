'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, Loader2, Tags } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Input, NativeSelect, Field } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import { DEPRECIATION_METHOD_LABELS, CATEGORY_TYPE_LABELS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import { fetchJson, errorText } from '../../reports/_components/format'

const CLASS_KEYS = Object.keys(TAX_DEPRECIATION_CLASSES)

function classText(key) {
  const c = TAX_DEPRECIATION_CLASSES[key]
  if (!c) return key
  return `${c.label} — ${c.rate}% ${c.method === 'SL' ? 'straight-line' : 'WDV'}`
}

const EMPTY = {
  name: '', code: '', type: 'ASSET', taxClass: 'COMPUTER', depreciationMethod: 'STRAIGHT_LINE',
  usefulLifeMonths: '', residualPct: '0', decliningRatePct: '', capitalize: true,
  requiresAcknowledgement: true, inputVatCreditable: false, description: '', isActive: true, sortOrder: '',
}

function Flag({ on, label }) {
  return (
    <Badge variant={on ? 'success' : 'outline'} className={cn(!on && 'text-gray-400 line-through')}>
      {label}
    </Badge>
  )
}

function CheckOption({ checked, onChange, label, sub, title }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-gray-900" title={title}>
      <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={checked} onChange={onChange} />
      <span>
        <span className="font-medium">{label}</span>
        {sub && <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>}
      </span>
    </label>
  )
}

function CategoryModal({ open, onOpenChange, category, onSaved }) {
  const editing = Boolean(category)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(category ? {
      name: category.name,
      code: category.code,
      type: category.type,
      taxClass: category.taxClass,
      depreciationMethod: category.depreciationMethod,
      usefulLifeMonths: category.usefulLifeMonths ?? '',
      residualPct: String(category.residualPct ?? 0),
      decliningRatePct: category.decliningRatePct ?? '',
      capitalize: category.capitalize,
      requiresAcknowledgement: category.requiresAcknowledgement,
      inputVatCreditable: category.inputVatCreditable,
      description: category.description ?? '',
      isActive: category.isActive,
      sortOrder: category.sortOrder ?? '',
    } : EMPTY)
  }, [open, category])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const cls = TAX_DEPRECIATION_CLASSES[form.taxClass]
  const consumable = form.type === 'CONSUMABLE'
  const usedAssets = category?.assetCount ?? 0

  async function save() {
    const name = form.name.trim()
    const code = form.code.trim().toUpperCase()
    if (name.length < 2) { toast.error('Enter a category name'); return }
    if (!/^[A-Z0-9]{2,6}$/.test(code)) { toast.error('Code must be 2–6 letters or digits'); return }
    const body = {
      name,
      code,
      type: form.type,
      taxClass: form.taxClass,
      depreciationMethod: consumable ? 'NONE' : form.depreciationMethod,
      usefulLifeMonths: form.usefulLifeMonths === '' ? null : Number(form.usefulLifeMonths),
      residualPct: form.residualPct === '' ? null : Number(form.residualPct),
      decliningRatePct: form.depreciationMethod === 'DECLINING_BALANCE' && form.decliningRatePct !== '' ? Number(form.decliningRatePct) : null,
      capitalize: consumable ? false : form.capitalize,
      requiresAcknowledgement: consumable ? false : form.requiresAcknowledgement,
      inputVatCreditable: form.inputVatCreditable,
      description: form.description.trim() || null,
      isActive: form.isActive,
      sortOrder: form.sortOrder === '' ? null : Number(form.sortOrder),
    }
    setSaving(true)
    try {
      await fetchJson(editing ? `/api/inventory/categories/${category.id}` : '/api/inventory/categories', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      toast.success(editing ? 'Category updated' : 'Category added')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${category.name}` : 'New category'} size="lg">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={form.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="e.g. Laptop" />
          </Field>
          <Field label="Code" required
            hint={editing && usedAssets > 0 ? 'Locked — used in asset tags' : 'Used in tags, e.g. ENLAP00042'}>
            <Input className="font-mono uppercase" value={form.code} maxLength={6}
              disabled={editing && usedAssets > 0}
              onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="LAP" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tracked as">
            <NativeSelect value={form.type} disabled={editing && ((category?.assetCount ?? 0) > 0 || (category?.stockItemCount ?? 0) > 0)}
              onChange={e => set('type', e.target.value)}>
              {Object.entries(CATEGORY_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Tax class (Third Schedule)"
            hint={cls ? `${cls.rate}% ${cls.method === 'SL' ? 'of cost' : 'of WDV'} a year${cls.costCap ? ` · cost capped at Tk ${cls.costCap.toLocaleString('en-IN')}` : ''} · new assets only` : null}>
            <NativeSelect value={form.taxClass} onChange={e => set('taxClass', e.target.value)} title="Income Tax Act 2023, Third Schedule">
              {CLASS_KEYS.map(k => <option key={k} value={k}>{classText(k)}</option>)}
            </NativeSelect>
          </Field>
        </div>

        {!consumable && (
          <div className="space-y-4 rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-900">Book depreciation</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Method">
                <NativeSelect value={form.depreciationMethod} onChange={e => set('depreciationMethod', e.target.value)}>
                  {Object.entries(DEPRECIATION_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Useful life (months)" hint={`Blank = ${cls?.bookLifeMonths ?? 60} months`}>
                <Input type="number" min="1" max="1200" step="1" value={form.usefulLifeMonths}
                  disabled={form.depreciationMethod === 'NONE'}
                  onChange={e => set('usefulLifeMonths', e.target.value)} placeholder={cls ? String(cls.bookLifeMonths) : '60'} />
              </Field>
              <Field label="Residual value %">
                <Input type="number" min="0" max="99" step="0.5" value={form.residualPct}
                  disabled={form.depreciationMethod === 'NONE'} onChange={e => set('residualPct', e.target.value)} />
              </Field>
              {form.depreciationMethod === 'DECLINING_BALANCE' && (
                <Field label="Declining rate % a year">
                  <Input type="number" min="0.1" max="100" step="0.5" value={form.decliningRatePct}
                    onChange={e => set('decliningRatePct', e.target.value)} placeholder="Blank = double-declining" />
                </Field>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {!consumable && (
            <>
              <CheckOption checked={form.capitalize} onChange={e => set('capitalize', e.target.checked)}
                label="Capitalise" sub="When cost reaches the threshold"
                title="Carried as an asset when the cost reaches the capitalisation threshold; otherwise expensed and tracked for custody only." />
              <CheckOption checked={form.requiresAcknowledgement} onChange={e => set('requiresAcknowledgement', e.target.checked)}
                label="Employee acknowledges hand-over" title="The assignee confirms receipt in My Assets." />
            </>
          )}
          <CheckOption checked={form.inputVatCreditable} onChange={e => set('inputVatCreditable', e.target.checked)}
            label="Input VAT creditable" sub="Off for office equipment, furniture, ACs, vehicles (VAT Act s.2(18A))"
            title={'VAT Act s.2(18A) excludes office equipment, furniture, ACs, vehicles and stationery from "input", so their VAT is added to cost.'} />
          <CheckOption checked={form.isActive} onChange={e => set('isActive', e.target.checked)}
            label="Active" title="Inactive categories can’t be used for new items." />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Description" className="sm:col-span-2">
            <Input value={form.description} maxLength={500} onChange={e => set('description', e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Sort order">
            <Input type="number" min="0" step="10" value={form.sortOrder} onChange={e => set('sortOrder', e.target.value)} placeholder="Auto" />
          </Field>
        </div>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving}>
          {editing ? 'Save changes' : 'Add category'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export default function CategoriesTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('ALL')
  const [showInactive, setShowInactive] = useState(false)
  const [modal, setModal] = useState({ open: false, category: null })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson('/api/inventory/categories?withCounts=1')
      setRows(json.data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => rows.filter(r =>
    (filter === 'ALL' || r.type === filter) && (showInactive || r.isActive)), [rows, filter, showInactive])
  const inactiveCount = rows.filter(r => !r.isActive).length

  async function toggleActive(c) {
    try {
      await fetchJson(`/api/inventory/categories/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !c.isActive }),
      })
      toast.success(c.isActive ? `${c.name} deactivated` : `${c.name} reactivated`)
      load()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  async function remove(c) {
    const inUse = (c.assetCount || 0) + (c.stockItemCount || 0) > 0
    const msg = inUse
      ? `"${c.name}" is in use, so it will be deactivated instead. Continue?`
      : `Delete "${c.name}"? This can't be undone.`
    if (!window.confirm(msg)) return
    try {
      const json = await fetchJson(`/api/inventory/categories/${c.id}`, { method: 'DELETE' })
      toast.success(json.deactivated ? (json.message || 'Deactivated') : 'Category deleted')
      load()
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[{ value: 'ALL', label: 'All' }, { value: 'ASSET', label: 'Assets' }, { value: 'CONSUMABLE', label: 'Consumables' }]}
        />
        {inactiveCount > 0 && (
          <label className="ml-1 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="rounded border-gray-300" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive ({inactiveCount})
          </label>
        )}
        <Button className="ml-auto" onClick={() => setModal({ open: true, category: null })}>
          <Plus /> New category
        </Button>
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Couldn't load categories" description={error}
            action={<Button variant="outline" onClick={load}>Try again</Button>} />
        ) : loading && !rows.length ? (
          <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
        ) : visible.length === 0 ? (
          <EmptyState icon={Tags} title="No categories yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead title="Sets the Third Schedule rate for the tax depreciation schedule">Tax class</TableHead>
                <TableHead title="Drives the monthly depreciation run. Existing assets keep their settings.">Book depreciation</TableHead>
                <TableHead>Rules</TableHead>
                <TableHead className="text-right">In use</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(c => (
                <TableRow key={c.id} className={cn('align-top', !c.isActive && 'opacity-60')}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">{c.code}</span>
                      <span className="font-medium text-gray-900">{c.name}</span>
                      {!c.isActive && <span className="text-xs text-gray-400">(inactive)</span>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{c.type === 'CONSUMABLE' ? 'Consumable' : 'Asset'}{c.description ? ` · ${c.description}` : ''}</p>
                  </TableCell>
                  <TableCell>
                    <p className="whitespace-nowrap">{c.taxClassLabel}</p>
                    <p className="text-xs text-muted-foreground">{c.taxRate}% {c.taxMethod === 'SL' ? 'straight-line' : 'WDV'}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {c.type === 'CONSUMABLE' || c.depreciationMethod === 'NONE' ? <span className="text-gray-400">—</span> : (
                      <>
                        <p>{DEPRECIATION_METHOD_LABELS[c.depreciationMethod]}</p>
                        <p className="text-xs text-muted-foreground">{c.usefulLifeMonths} months{c.residualPct ? ` · ${c.residualPct}% residual` : ''}{c.decliningRatePct ? ` · ${c.decliningRatePct}%/yr` : ''}</p>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.type !== 'CONSUMABLE' && <Flag on={c.capitalize} label="Capitalise" />}
                      {c.type !== 'CONSUMABLE' && <Flag on={c.requiresAcknowledgement} label="Acknowledge" />}
                      <Flag on={c.inputVatCreditable} label="Input VAT" />
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {c.type === 'CONSUMABLE' ? `${c.stockItemCount} item${c.stockItemCount === 1 ? '' : 's'}` : `${c.heldCount} held`}
                    {c.type !== 'CONSUMABLE' && c.assetCount > c.heldCount && <p className="text-xs text-gray-400">{c.assetCount - c.heldCount} disposed</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    <ActionMenu items={[
                      { label: 'Edit', icon: Pencil, onClick: () => setModal({ open: true, category: c }) },
                      { label: c.isActive ? 'Deactivate' : 'Reactivate', icon: c.isActive ? Archive : ArchiveRestore, onClick: () => toggleActive(c) },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(c) },
                    ]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CategoryModal open={modal.open} category={modal.category}
        onOpenChange={o => setModal(m => ({ ...m, open: o }))} onSaved={load} />
    </div>
  )
}
