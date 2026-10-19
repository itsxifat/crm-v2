'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { STOCK_UNITS } from '@/lib/inventory/constants'
import VendorPicker from '../../purchases/_components/VendorPicker'
import { ic, lc, num, tk } from './stockShared'

const blankForm = (today) => ({
  name: '',
  sku: '',
  categoryId: '',
  unit: 'pcs',
  reorderLevel: '',
  reorderQty: '',
  vendor: null,
  locationId: '',
  notes: '',
  isActive: true,
  openingQty: '',
  openingCost: '',
  openingDate: today,
})

/** Create or edit a consumable stock item. Create can include opening stock. */
export default function StockItemModal({ open, onOpenChange, item = null, categories = [], locations = [], onSaved }) {
  const today = dhakaDayKey(new Date())
  const [form, setForm] = useState(() => blankForm(today))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const isEdit = Boolean(item)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (item) {
      setForm({
        ...blankForm(today),
        name: item.name ?? '',
        sku: item.sku ?? '',
        categoryId: item.categoryId ?? '',
        unit: item.unit ?? 'pcs',
        reorderLevel: item.reorderLevel ? String(item.reorderLevel) : '',
        reorderQty: item.reorderQty ? String(item.reorderQty) : '',
        vendor: item.preferredVendor ? { id: item.preferredVendor.id, company: item.preferredVendor.company, bin: null, vatRegistrationType: null, payeeType: 'COMPANY', hasPsr: false } : null,
        locationId: item.locationId ?? '',
        notes: item.notes ?? '',
        isActive: item.isActive !== false,
      })
    } else {
      setForm(blankForm(today))
    }
  }, [open, item]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const consumableCats = categories.filter(c => c.type === 'CONSUMABLE')
  const hasOpening = !isEdit && num(form.openingQty) > 0

  async function submit() {
    if (!form.name.trim()) { setError('Enter the item name'); return }
    if (hasOpening && form.openingCost === '') { setError('Enter the unit cost of the opening stock'); return }
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        categoryId: form.categoryId || null,
        unit: form.unit.trim() || 'pcs',
        reorderLevel: num(form.reorderLevel),
        reorderQty: num(form.reorderQty),
        preferredVendorId: form.vendor?.id ?? null,
        locationId: form.locationId || null,
        notes: form.notes.trim() || null,
        ...(isEdit ? { isActive: form.isActive } : {}),
        ...(hasOpening ? { opening: { qty: num(form.openingQty), unitCost: num(form.openingCost), date: form.openingDate } } : {}),
      }
      const res = await fetch(isEdit ? `/api/inventory/stock/${item.id}` : '/api/inventory/stock', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not save the item')
      toast.success(isEdit ? 'Item updated' : `${json.data?.sku ?? 'Item'} added`)
      onSaved?.(json.data)
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v) }} title={isEdit ? `Edit ${item?.sku ?? 'item'}` : 'Add stock item'}
      description={isEdit ? 'Quantities change only through movements.' : 'Consumables are tracked by quantity at moving average cost.'} size="lg">
      <datalist id="stock-units">{STOCK_UNITS.map(u => <option key={u} value={u} />)}</datalist>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className={lc}>Item name <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => set({ name: e.target.value })} className={ic} maxLength={200} placeholder="e.g. A4 paper 80gsm (ream)" autoFocus />
          </div>
          <div>
            <label className={lc}>SKU <span className="text-gray-400 font-normal">(auto if blank)</span></label>
            <input value={form.sku} onChange={e => set({ sku: e.target.value.toUpperCase() })} className={ic} maxLength={40} placeholder="STA-0001" />
          </div>
          <div>
            <label className={lc}>Category</label>
            <select value={form.categoryId} onChange={e => set({ categoryId: e.target.value })} className={ic}>
              <option value="">Uncategorised</option>
              {consumableCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lc}>Unit</label>
            <input value={form.unit} onChange={e => set({ unit: e.target.value })} list="stock-units" className={ic} maxLength={20} />
          </div>
          <div>
            <label className={lc}>Store location</label>
            <select value={form.locationId} onChange={e => set({ locationId: e.target.value })} className={ic}>
              <option value="">Not set</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lc}>Reorder level</label>
            <input type="number" min="0" step="any" value={form.reorderLevel} onChange={e => set({ reorderLevel: e.target.value })} className={ic} placeholder="0 = alert only when empty" />
          </div>
          <div>
            <label className={lc}>Reorder quantity</label>
            <input type="number" min="0" step="any" value={form.reorderQty} onChange={e => set({ reorderQty: e.target.value })} className={ic} placeholder="Suggested order size" />
          </div>
          <div className="sm:col-span-1">
            <label className={lc}>Preferred vendor</label>
            <VendorPicker value={form.vendor} onChange={v => set({ vendor: v })} placeholder="Optional" />
          </div>
          <div className="sm:col-span-3">
            <label className={lc}>Notes</label>
            <input value={form.notes} onChange={e => set({ notes: e.target.value })} className={ic} maxLength={1000} placeholder="Brand preference, storage instructions…" />
          </div>
        </div>

        {isEdit ? (
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.isActive} onChange={e => set({ isActive: e.target.checked })} />
            <span>
              <span className="font-medium">Active</span>
              <span className="block text-xs text-gray-500">Inactive items are hidden from purchase bills and cannot be issued{num(item?.qtyOnHand) > 0 ? ` — ${num(item.qtyOnHand)} ${item.unit} still on hand` : ''}.</span>
            </span>
          </label>
        ) : (
          <div className="rounded-xl border border-gray-100 p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Opening stock <span className="text-gray-400 font-normal">(optional)</span></p>
              <p className="text-xs text-gray-500">What is already in the store today. New purchases come in through purchase bills.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={lc}>Quantity</label>
                <input type="number" min="0" step="any" value={form.openingQty} onChange={e => set({ openingQty: e.target.value })} className={ic} />
              </div>
              <div>
                <label className={lc}>Unit cost (BDT)</label>
                <input type="number" min="0" step="0.01" value={form.openingCost} onChange={e => set({ openingCost: e.target.value })} className={ic} />
                {hasOpening && form.openingCost !== '' && <p className="mt-1 text-[11px] text-gray-400">Value {tk(num(form.openingQty) * num(form.openingCost))}</p>}
              </div>
              <div>
                <label className={lc}>As of</label>
                <DatePicker value={form.openingDate} onChange={v => set({ openingDate: v || today })} clearable={false} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </div>
      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 bg-white">Cancel</button>
        <button type="button" onClick={submit} disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1.5">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Add item'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
