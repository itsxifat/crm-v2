'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, Loader2, Tags, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import { DEPRECIATION_METHOD_LABELS, CATEGORY_TYPE_LABELS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import { fetchJson, errorText } from '../../reports/_components/format'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const hintCls = 'mt-1 text-xs text-gray-400'
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'

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
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium', on ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400 line-through')}>
      {label}
    </span>
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
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${category.name}` : 'New category'}
      description="How items in this category are tracked, depreciated and taxed" size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={form.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="e.g. Laptop" />
          </div>
          <div>
            <label className={labelCls}>Code</label>
            <input className={cn(inputCls, 'font-mono uppercase')} value={form.code} maxLength={6}
              disabled={editing && usedAssets > 0}
              onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="LAP" />
            <p className={hintCls}>{editing && usedAssets > 0 ? 'Used in asset tags — cannot change' : 'Used in asset tags, e.g. EN-LAP-00042'}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Tracked as</label>
            <select className={inputCls} value={form.type} disabled={editing && ((category?.assetCount ?? 0) > 0 || (category?.stockItemCount ?? 0) > 0)}
              onChange={e => set('type', e.target.value)}>
              {Object.entries(CATEGORY_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tax class (Income Tax Act 2023, Third Schedule)</label>
            <select className={inputCls} value={form.taxClass} onChange={e => set('taxClass', e.target.value)}>
              {CLASS_KEYS.map(k => <option key={k} value={k}>{classText(k)}</option>)}
            </select>
            {cls && <p className={hintCls}>Tax allowance {cls.rate}% {cls.method === 'SL' ? 'of cost a year' : 'of written-down value a year'}{cls.costCap ? ` · cost capped at Tk ${cls.costCap.toLocaleString('en-IN')}` : ''}. Changes apply to assets added from now on.</p>}
          </div>
        </div>

        {!consumable && (
          <div className="rounded-xl border border-gray-100 p-4 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Book depreciation</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Method</label>
                <select className={inputCls} value={form.depreciationMethod} onChange={e => set('depreciationMethod', e.target.value)}>
                  {Object.entries(DEPRECIATION_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Useful life (months)</label>
                <input type="number" min="1" max="1200" step="1" className={inputCls} value={form.usefulLifeMonths}
                  disabled={form.depreciationMethod === 'NONE'}
                  onChange={e => set('usefulLifeMonths', e.target.value)} placeholder={cls ? String(cls.bookLifeMonths) : '60'} />
                <p className={hintCls}>Blank = {cls?.bookLifeMonths ?? 60} months (class default)</p>
              </div>
              <div>
                <label className={labelCls}>Residual value %</label>
                <input type="number" min="0" max="99" step="0.5" className={inputCls} value={form.residualPct}
                  disabled={form.depreciationMethod === 'NONE'} onChange={e => set('residualPct', e.target.value)} />
              </div>
              {form.depreciationMethod === 'DECLINING_BALANCE' && (
                <div>
                  <label className={labelCls}>Declining rate % a year</label>
                  <input type="number" min="0.1" max="100" step="0.5" className={inputCls} value={form.decliningRatePct}
                    onChange={e => set('decliningRatePct', e.target.value)} placeholder="Double-declining if blank" />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {!consumable && (
            <>
              <label className="flex items-start gap-2.5 text-sm text-gray-700">
                <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.capitalize} onChange={e => set('capitalize', e.target.checked)} />
                <span>Capitalise<span className="block text-xs text-gray-400">Carried as an asset when the cost reaches the capitalisation threshold; otherwise expensed and tracked for custody only.</span></span>
              </label>
              <label className="flex items-start gap-2.5 text-sm text-gray-700">
                <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.requiresAcknowledgement} onChange={e => set('requiresAcknowledgement', e.target.checked)} />
                <span>Employee acknowledges hand-over<span className="block text-xs text-gray-400">The assignee confirms receipt in My Assets.</span></span>
              </label>
            </>
          )}
          <label className="flex items-start gap-2.5 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.inputVatCreditable} onChange={e => set('inputVatCreditable', e.target.checked)} />
            <span>Input VAT creditable<span className="block text-xs text-gray-400">Leave off for office equipment, furniture, ACs, vehicles and stationery — VAT Act s.2(18A) excludes them from &quot;input&quot;, so their VAT is added to cost.</span></span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
            <span>Active<span className="block text-xs text-gray-400">Inactive categories can’t be used for new items.</span></span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Description</label>
            <input className={inputCls} value={form.description} maxLength={500} onChange={e => set('description', e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className={labelCls}>Sort order</label>
            <input type="number" min="0" step="10" className={inputCls} value={form.sortOrder} onChange={e => set('sortOrder', e.target.value)} placeholder="Auto" />
          </div>
        </div>
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
        <button className={btnGhost} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing ? 'Save changes' : 'Add category'}
        </button>
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
      ? `"${c.name}" is in use, so it will be deactivated instead of deleted. Continue?`
      : `Delete the category "${c.name}"? This cannot be undone.`
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[['ALL', 'All'], ['ASSET', 'Assets'], ['CONSUMABLE', 'Consumables']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border', filter === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
              {l}
            </button>
          ))}
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-600 ml-1">
              <input type="checkbox" className="rounded border-gray-300" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show inactive ({inactiveCount})
            </label>
          )}
        </div>
        <button className={btnPrimary} onClick={() => setModal({ open: true, category: null })}>
          <Plus className="w-4 h-4" /> New category
        </button>
      </div>

      <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3">
        <Info className="w-4 h-4 shrink-0 text-gray-400" />
        <span>The tax class sets the Third Schedule rate used in the tax depreciation schedule; the book method and life drive the monthly depreciation run. Existing assets keep the settings they were created with.</span>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {error ? (
          <EmptyState title="Couldn't load categories" description={error}
            action={<button className={btnPrimary} onClick={load}>Try again</button>} />
        ) : loading && !rows.length ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : visible.length === 0 ? (
          <EmptyState icon={Tags} title="No categories" description="Add categories to group assets and consumables and set how they depreciate." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Category</th>
                  <th className="px-3 py-3">Tax class</th>
                  <th className="px-3 py-3">Book depreciation</th>
                  <th className="px-3 py-3">Rules</th>
                  <th className="px-3 py-3 text-right">In use</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map(c => (
                  <tr key={c.id} className={cn('hover:bg-gray-50/60 align-top', !c.isActive && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">{c.code}</span>
                        <span className="font-medium text-gray-900">{c.name}</span>
                        {!c.isActive && <span className="text-xs text-gray-400">(inactive)</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{c.type === 'CONSUMABLE' ? 'Consumable' : 'Asset'}{c.description ? ` · ${c.description}` : ''}</p>
                    </td>
                    <td className="px-3 py-3 text-gray-700">
                      <p className="whitespace-nowrap">{c.taxClassLabel}</p>
                      <p className="text-xs text-gray-500">{c.taxRate}% {c.taxMethod === 'SL' ? 'straight-line' : 'WDV'}</p>
                    </td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                      {c.type === 'CONSUMABLE' || c.depreciationMethod === 'NONE' ? <span className="text-gray-400">—</span> : (
                        <>
                          <p>{DEPRECIATION_METHOD_LABELS[c.depreciationMethod]}</p>
                          <p className="text-xs text-gray-500">{c.usefulLifeMonths} months{c.residualPct ? ` · ${c.residualPct}% residual` : ''}{c.decliningRatePct ? ` · ${c.decliningRatePct}%/yr` : ''}</p>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.type !== 'CONSUMABLE' && <Flag on={c.capitalize} label="Capitalise" />}
                        {c.type !== 'CONSUMABLE' && <Flag on={c.requiresAcknowledgement} label="Acknowledge" />}
                        <Flag on={c.inputVatCreditable} label="Input VAT" />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700 whitespace-nowrap">
                      {c.type === 'CONSUMABLE' ? `${c.stockItemCount} item${c.stockItemCount === 1 ? '' : 's'}` : `${c.heldCount} held`}
                      {c.type !== 'CONSUMABLE' && c.assetCount > c.heldCount && <p className="text-xs text-gray-400">{c.assetCount - c.heldCount} disposed</p>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ActionMenu items={[
                        { label: 'Edit', icon: Pencil, onClick: () => setModal({ open: true, category: c }) },
                        { label: c.isActive ? 'Deactivate' : 'Reactivate', icon: c.isActive ? Archive : ArchiveRestore, onClick: () => toggleActive(c) },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(c) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CategoryModal open={modal.open} category={modal.category}
        onOpenChange={o => setModal(m => ({ ...m, open: o }))} onSaved={load} />
    </div>
  )
}
