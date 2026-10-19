'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Input, Label, NativeSelect } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import PeoplePicker from '@/components/ui/PeoplePicker'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { STOCK_MOVEMENT_META } from '@/lib/inventory/constants'
import { num, qtyText, round2, tk, useDepartments } from './stockShared'

const TYPES = [
  { value: 'ISSUE',      perm: 'inventory.assign', hint: 'Hand out to an employee, department or project' },
  { value: 'RETURN',     perm: 'inventory.assign', hint: 'Unused stock coming back to the store' },
  { value: 'ADJUST_IN',  perm: 'inventory.manage', hint: 'Count found more than the system shows' },
  { value: 'ADJUST_OUT', perm: 'inventory.manage', hint: 'Count found less than the system shows' },
  { value: 'DAMAGED',    perm: 'inventory.manage', hint: 'Broken, expired or spoiled stock' },
  { value: 'OPENING',    perm: 'inventory.manage', hint: 'Stock on hand at go-live (first entry only)' },
]

const REASONS = {
  ADJUST_IN: ['Stock count difference', 'Found in store', 'Data entry correction'],
  ADJUST_OUT: ['Stock count difference', 'Missing', 'Data entry correction'],
  DAMAGED: ['Expired', 'Broken', 'Spoiled / leaked'],
}

/**
 * Record one manual stock movement for an item (POST /api/inventory/stock/[id]/movements).
 */
export default function MovementModal({ open, onOpenChange, item, initialType = 'ISSUE', onDone }) {
  const { can } = usePermission()
  const departments = useDepartments()
  const today = dhakaDayKey(new Date())

  const allowed = useMemo(() => TYPES.filter(t => can(t.perm) && (t.value !== 'OPENING' || (item && num(item.qtyOnHand) === 0 && num(item.avgCost) === 0))),
    [can, item])

  const [type, setType] = useState(initialType)
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [employee, setEmployee] = useState(null)
  const [departmentId, setDepartmentId] = useState('')
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    const first = allowed.find(t => t.value === initialType) ?? allowed[0]
    setType(first?.value ?? initialType)
    setQty('')
    setUnitCost('')
    setEmployee(null)
    setDepartmentId('')
    setReason('')
    setReference('')
    setDate(today)
    setError(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null
  const meta = STOCK_MOVEMENT_META[type] ?? {}
  const isOut = meta.direction === 'OUT'
  const q = num(qty)
  const onHand = num(item.qtyOnHand)
  const after = isOut ? onHand - q : onHand + q
  const short = isOut && q > onHand + 0.00005
  const costed = ['ADJUST_IN', 'OPENING', 'RETURN'].includes(type)
  const value = round2(q * (costed && unitCost !== '' ? num(unitCost) : num(item.avgCost)))
  const needsReason = ['ADJUST_IN', 'ADJUST_OUT', 'DAMAGED'].includes(type)
  const needsRecipient = type === 'ISSUE' && !employee && !departmentId
  const willBeLow = isOut && !short && num(item.reorderLevel) > 0 && after <= num(item.reorderLevel)

  async function submit() {
    if (!(q > 0)) { setError('Enter a quantity'); return }
    if (short) { setError(`Only ${qtyText(onHand)} ${item.unit} on hand`); return }
    if (needsRecipient) { setError('Choose who receives the stock'); return }
    if (needsReason && reason.trim().length < 3) { setError('Give a reason'); return }
    if (type === 'OPENING' && unitCost === '') { setError('Enter the unit cost of the opening stock'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/stock/${item.id}/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          qty: q,
          unitCost: costed && unitCost !== '' ? num(unitCost) : null,
          employeeId: ['ISSUE', 'RETURN'].includes(type) ? (employee?.id ?? null) : null,
          departmentId: ['ISSUE', 'RETURN'].includes(type) ? (departmentId || null) : null,
          reason: reason.trim() || null,
          reference: reference.trim() || null,
          date,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Couldn't record the movement")
      const m = json.data?.movement
      toast.success(`${STOCK_MOVEMENT_META[type]?.label ?? type}: ${qtyText(q)} ${item.unit}${m?.movementNo ? ` (${m.movementNo})` : ''}`)
      if (json.lowStockAlert) toast(`${item.name} is now low — managers were notified`, { duration: 6000 })
      onDone?.(json.data?.item ?? null)
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v) }} title={item.name}
      description={`${item.sku} · ${qtyText(onHand)} ${item.unit} on hand · avg ${tk(item.avgCost)}`} size="md">
      <div className="space-y-5">
        {allowed.length === 0 ? (
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to move this stock.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {allowed.map(t => {
              const m = STOCK_MOVEMENT_META[t.value]
              const active = type === t.value
              const Icon = m.direction === 'OUT' ? ArrowUpRight : ArrowDownLeft
              return (
                <button key={t.value} type="button" onClick={() => setType(t.value)} title={t.hint}
                  className={cn('flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-left text-[13px] font-medium transition-colors',
                    active ? 'border-gray-900 bg-gray-900 text-white shadow-xs' : 'border-gray-200/80 bg-white text-gray-700 hover:bg-gray-50')}>
                  <Icon className={cn('size-4 shrink-0', active ? 'text-white' : m.direction === 'OUT' ? 'text-orange-500' : 'text-emerald-600')} />
                  <span className="truncate">{m.label}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Quantity ({item.unit})</Label>
            <Input type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}
              invalid={short} className="tabular-nums" autoFocus />
            <p className={cn('mt-1.5 text-xs tabular-nums', short ? 'text-red-600' : 'text-muted-foreground')}>
              {q > 0 ? `${qtyText(onHand)} → ${qtyText(Math.max(0, after))} ${item.unit}` : `${qtyText(onHand)} ${item.unit} on hand`}
            </p>
          </div>
          {costed ? (
            <Field label="Unit cost" required={type === 'OPENING'} hint={`Value ${tk(value)}`}>
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={unitCost} onChange={e => setUnitCost(e.target.value)}
                className="tabular-nums" placeholder={num(item.avgCost).toFixed(2)} />
            </Field>
          ) : (
            <div>
              <Label>Value at average cost</Label>
              <p className="flex h-9 items-center text-sm tabular-nums text-gray-900">{tk(value)}</p>
            </div>
          )}
        </div>

        {['ISSUE', 'RETURN'].includes(type) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={type === 'ISSUE' ? 'Issued to (employee)' : 'Returned by'}>
              <PeoplePicker types={['EMPLOYEE']} typeFilter={false} value={employee} onChange={setEmployee} placeholder="Search employee…" />
            </Field>
            <Field label="Department">
              <NativeSelect value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">—</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
        )}

        <div>
          <Label required={needsReason}>Reason</Label>
          {REASONS[type] && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REASONS[type].map(r => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className={cn('h-7 rounded-md border px-2 text-xs transition-colors', reason === r ? 'border-gray-900 bg-gray-100 text-gray-900' : 'border-gray-200/80 text-gray-600 hover:bg-gray-50')}>
                  {r}
                </button>
              ))}
            </div>
          )}
          <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
            placeholder={type === 'ISSUE' ? 'e.g. Monthly office supplies' : 'Reason…'} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Reference">
            <Input value={reference} onChange={e => setReference(e.target.value)} maxLength={120} placeholder="Requisition / count sheet no." />
          </Field>
          <Field label="Date" hint={isOut && date && date < today ? 'Back-dated: stock must be on hand that day and after.' : null}>
            <DatePicker value={date} onChange={v => setDate(v || today)} clearable={false} />
          </Field>
        </div>

        {willBeLow && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Reaches its reorder level ({qtyText(item.reorderLevel)} {item.unit}) — managers will be alerted.
          </p>
        )}
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={allowed.length === 0 || short || !(q > 0)}>
          Record {STOCK_MOVEMENT_META[type]?.label?.toLowerCase() ?? 'movement'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
