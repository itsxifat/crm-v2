'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Input, Label, NativeSelect } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { STOCK_UNITS } from '@/lib/inventory/constants'
import VendorPicker from '../../purchases/_components/VendorPicker'
import { num, tk } from './stockShared'

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
      if (!res.ok) throw new Error(json.error || "Couldn't save the item")
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
      description={isEdit ? 'Quantities change only through movements.' : undefined} size="lg">
      <datalist id="stock-units">{STOCK_UNITS.map(u => <option key={u} value={u} />)}</datalist>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Item name" required className="sm:col-span-2">
            <Input value={form.name} onChange={e => set({ name: e.target.value })} maxLength={200} placeholder="e.g. A4 paper 80gsm (ream)" autoFocus />
          </Field>
          <Field label="SKU">
            <Input value={form.sku} onChange={e => set({ sku: e.target.value.toUpperCase() })} maxLength={40} placeholder="Auto if blank" />
          </Field>
          <Field label="Category">
            <NativeSelect value={form.categoryId} onChange={e => set({ categoryId: e.target.value })}>
              <option value="">Uncategorised</option>
              {consumableCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Unit">
            <Input value={form.unit} onChange={e => set({ unit: e.target.value })} list="stock-units" maxLength={20} />
          </Field>
          <Field label="Store location">
            <NativeSelect value={form.locationId} onChange={e => set({ locationId: e.target.value })}>
              <option value="">Not set</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
          <div>
            <Label title="0 = alert only when empty">Reorder level</Label>
            <Input type="number" min="0" step="any" value={form.reorderLevel} onChange={e => set({ reorderLevel: e.target.value })} placeholder="0" />
          </div>
          <Field label="Reorder quantity">
            <Input type="number" min="0" step="any" value={form.reorderQty} onChange={e => set({ reorderQty: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Preferred vendor" className="sm:col-span-1">
            <VendorPicker value={form.vendor} onChange={v => set({ vendor: v })} placeholder="Optional" />
          </Field>
          <Field label="Notes" className="sm:col-span-3">
            <Input value={form.notes} onChange={e => set({ notes: e.target.value })} maxLength={1000} placeholder="Brand, storage…" />
          </Field>
        </div>

        {isEdit ? (
          <label className="flex items-start gap-2.5 text-sm text-gray-900">
            <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.isActive} onChange={e => set({ isActive: e.target.checked })} />
            <span>
              <span className="font-medium">Active</span>
              <span className="block text-xs text-muted-foreground">Inactive items can&apos;t be bought or issued{num(item?.qtyOnHand) > 0 ? ` — ${num(item.qtyOnHand)} ${item.unit} still on hand` : ''}.</span>
            </span>
          </label>
        ) : (
          <div className="space-y-4 rounded-lg border border-gray-200/80 p-4">
            <p className="text-sm font-semibold text-gray-900">Opening stock <span className="font-normal text-muted-foreground">· optional</span></p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Quantity">
                <Input type="number" min="0" step="any" value={form.openingQty} onChange={e => set({ openingQty: e.target.value })} />
              </Field>
              <Field label="Unit cost (BDT)" hint={hasOpening && form.openingCost !== '' ? `Value ${tk(num(form.openingQty) * num(form.openingCost))}` : null}>
                <Input type="number" min="0" step="0.01" value={form.openingCost} onChange={e => set({ openingCost: e.target.value })} />
              </Field>
              <Field label="As of">
                <DatePicker value={form.openingDate} onChange={v => set({ openingDate: v || today })} clearable={false} />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving}>
          {isEdit ? 'Save changes' : 'Add item'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
