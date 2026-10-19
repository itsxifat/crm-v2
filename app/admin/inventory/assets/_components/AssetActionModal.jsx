'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import PeoplePicker from '@/components/ui/PeoplePicker'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import { Input, Textarea, NativeSelect, Label } from '@/components/ui/Input'
import MoneyAccountSelect, { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { cn } from '@/lib/utils'
import { VAT_RATE_OPTIONS, isValidBin } from '@/lib/tax/catalog'
import {
  CONDITION_OPTIONS, DAMAGE_CAUSE_OPTIONS, RECOVERY_METHOD_OPTIONS, DAMAGE_CAUSE_LABELS, RECOVERY_METHOD_LABELS,
  STATUS_META, round2,
} from '@/lib/inventory/constants'
import {
  ASSET_ACTIONS, NON_RECOVERABLE_CAUSES, EMPLOYEE_RECOVERY_METHODS, disposalPreview, maxRecoverable, hasHolder,
  returnActionLabel,
} from '@/lib/inventory/actions'
import { periodLabelOf as rawPeriodLabel } from '@/lib/inventory/depreciationMath'

/** 'Oct 2026' for '2026-10' (falls back to the raw value instead of throwing). */
const periodLabelOf = (p) => { try { return rawPeriodLabel(p) } catch { return p ?? '' } }
import {
  Field, tk, todayKey, apiJson, useAssetOptions, holderName, refId,
  openPrint, fmtDay,
} from './shared'

const WRITE_OFF_REASONS = [
  'Lost — not recovered after search',
  'Stolen — police GD filed',
  'Damaged beyond economic repair',
  'Obsolete — no further use',
]

function Notice({ tone = 'info', children }) {
  const cls = tone === 'warn'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : tone === 'danger' ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200/80 bg-gray-50 text-gray-700'
  const Icon = tone === 'info' ? Info : AlertTriangle
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] leading-5', cls)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'info' && 'text-gray-500')} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function PreviewRow({ label, value, strong, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-right tabular-nums', strong && 'font-semibold', tone === 'gain' && 'text-emerald-700', tone === 'loss' && 'text-red-600', !tone && 'text-gray-900')}>{value}</span>
    </div>
  )
}

/** What a sale / scrap / write-off / donation does to the books (live preview). */
function DisposalPreviewPanel({ asset, kind, date, proceeds, vatRate, convention, postToLedger }) {
  const p = useMemo(
    () => disposalPreview(asset, { date, proceeds: Number(proceeds) || 0, vatRate: Number(vatRate) || 0, convention }),
    [asset, date, proceeds, vatRate, convention],
  )
  const hasProceeds = p.proceeds > 0
  const dep = p.depreciation
  const over = p.overPosted ?? { amount: 0, lines: [] }
  const overSpan = over.lines.length
    ? `${periodLabelOf(over.lines[0].period)}${over.lines.length > 1 ? ` – ${periodLabelOf(over.lines[over.lines.length - 1].period)}` : ''}`
    : ''
  const glLabel = p.gainLoss >= 0 ? 'Gain on disposal' : 'Loss on disposal'
  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <h4 className="mb-2 text-sm font-medium text-gray-900">Effect on the books</h4>
      {p.capitalized ? (
        <>
          <PreviewRow label="Cost" value={tk(p.cost)} />
          <PreviewRow label="Accumulated depreciation so far" value={tk(p.accumulatedBefore)} />
          {dep.amount > 0 && (
            <PreviewRow
              label={`Depreciation to ${fmtDay(date)} (${dep.months} mo${dep.fromPeriod ? `, ${periodLabelOf(dep.fromPeriod)}${dep.fromPeriod !== dep.toPeriod ? ` – ${periodLabelOf(dep.toPeriod)}` : ''}` : ''})`}
              value={tk(dep.amount)}
            />
          )}
          {over.amount > 0 && (
            <PreviewRow label={`Depreciation posted after ${fmtDay(date)} written back (${overSpan})`} value={`− ${tk(over.amount)}`} />
          )}
          <PreviewRow label="Book value at disposal" value={tk(p.bookValue)} strong />
        </>
      ) : (
        <PreviewRow label="Book value" value={<span>{tk(0)} <span className="text-xs text-gray-400">(expensed when bought)</span></span>} strong />
      )}
      {hasProceeds && (
        <>
          <PreviewRow label="Proceeds (excl. VAT)" value={tk(p.proceeds)} />
          {p.vatAmount > 0 && <PreviewRow label={`Output VAT @ ${p.vatRate}%`} value={tk(p.vatAmount)} />}
          <PreviewRow label="Money received" value={tk(p.gross)} />
        </>
      )}
      <div className="border-t border-gray-200 mt-2 pt-2">
        {hasProceeds ? (
          <PreviewRow label={glLabel} value={`${p.gainLoss >= 0 ? '+' : '−'} ${tk(Math.abs(p.gainLoss))}`} strong tone={p.gainLoss >= 0 ? 'gain' : 'loss'} />
        ) : (
          <PreviewRow label={kind === 'donate' ? 'Charged to P&L (donation)' : 'Written off to P&L'} value={tk(p.bookValue)} strong tone={p.bookValue > 0 ? 'loss' : undefined} />
        )}
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        {p.capitalized && dep.amount > 0 && <li>{postToLedger ? 'Depreciation' : 'Depreciation (register only — ledger posting is off)'} of {tk(dep.amount)} up to the disposal date</li>}
        {p.capitalized && over.amount > 0 && <li>{postToLedger ? 'Depreciation written back' : 'Depreciation written back (register only — ledger posting is off)'}: {tk(over.amount)} already posted for days after the disposal date</li>}
        {hasProceeds && <li>Asset sale {tk(p.gross)} into the selected account (not income — only the gain or loss hits P&amp;L)</li>}
        {hasProceeds && Math.abs(p.gainLoss) > 0.005 && <li>{glLabel} {tk(Math.abs(p.gainLoss))} (non-cash)</li>}
        {!hasProceeds && p.bookValue > 0 && <li>Asset write-off {tk(p.bookValue)} (non-cash)</li>}
        {p.vatAmount > 0 && <li>Output VAT {tk(p.vatAmount)} in this month&apos;s Mushak-9.1</li>}
      </ul>
    </div>
  )
}

function AttachmentsField({ value, onChange, label = 'Attachments' }) {
  const [pending, setPending] = useState('')
  useEffect(() => {
    if (pending) {
      onChange([...(value ?? []), pending])
      setPending('')
    }
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-2">
      <Label className="mb-0">{label}</Label>
      {(value ?? []).map((u, i) => (
        <div key={`${u}-${i}`} className="flex items-center gap-2 rounded-lg bg-gray-50 py-1 pl-2.5 pr-1 text-xs">
          <a href={u} target="_blank" rel="noopener noreferrer" className="flex-1 truncate font-medium text-gray-900 underline-offset-4 hover:underline">{u.split('/').pop()}</a>
          <Button variant="ghost" size="icon-xs" className="text-gray-400 hover:text-red-600" aria-label="Remove attachment" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-3.5" /></Button>
        </div>
      ))}
      {(value ?? []).length < 10 && <FileUpload label={null} value="" onUploaded={(url) => url && setPending(url)} bucket="assets" />}
    </div>
  )
}

const DEFAULTS = {
  employee: null, departmentId: '', locationId: '', expectedReturnDate: null, condition: '', printHandover: true,
  vendorId: '', vendorName: '', repairRef: '', expectedDate: null,
  cost: '', vatAmount: '', paymentMode: 'REQUEST', capitalize: false, returnTo: '',
  cause: '', description: '', responsible: null, liabilityPct: '', assessedLoss: '', recoveryMethod: 'NONE', recoveryAmount: '',
  enquiryNote: '', gdNumber: '',
  recStatus: 'RECOVERED', recAmount: '', accountId: null, recNote: '',
  buyerName: '', buyerBin: '', proceeds: '', vatRate: '', reason: '', recipient: '',
  adjustMode: 'IMPAIRMENT', impairment: '', newCost: '',
}

/**
 * One modal for every asset action. `action` is an ASSET_ACTIONS key.
 * @param {{ open, onOpenChange, action, asset, settings, damageCase?, repairSent?, canCapitalize?, onDone(json) }} props
 */
export default function AssetActionModal({ open, onOpenChange, action, asset, settings, damageCase = null, repairSent = null, canCapitalize = false, onDone }) {
  const { locations, departments, vendors } = useAssetOptions()
  const def = ASSET_ACTIONS[action] ?? null
  const [f, setF] = useState(DEFAULTS)
  const [date, setDate] = useState(todayKey())
  const [notes, setNotes] = useState('')
  const [attachments, setAttachments] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))

  const registered = (settings?.vatRegistrationType ?? 'REGISTERED') === 'REGISTERED'
  const convention = settings?.convention ?? 'PRORATA_DAYS'
  const holder = holderName(asset)
  const assignee = asset?.assignedEmployeeId && typeof asset.assignedEmployeeId === 'object' ? asset.assignedEmployeeId : null

  useEffect(() => {
    if (!open || !asset) return
    setError('')
    setDate(todayKey())
    setNotes('')
    setAttachments([])
    const defaultVat = registered ? String(settings?.defaultSalesRate ?? 15) : '0'
    const next = {
      ...DEFAULTS,
      condition: asset.condition ?? '',
      locationId: '',
      vatRate: defaultVat,
      returnTo: hasHolder(asset) ? 'ASSIGNED' : 'IN_STOCK',
      responsible: assignee ? { id: assignee.id, type: 'EMPLOYEE', name: assignee.name ?? assignee.employeeId, sub: assignee.employeeId } : null,
      // Completing a repair defaults to the vendor / job it was sent with.
      vendorId: action === 'repair_complete' ? (repairSent?.vendorId ?? '') : '',
      vendorName: action === 'repair_complete' ? (repairSent?.vendorName ?? '') : '',
      repairRef: action === 'repair_complete' ? (repairSent?.repairRef ?? '') : '',
    }
    if (action === 'report_damage') {
      next.condition = 'BROKEN'
      if (damageCase?.reportedByEmployee) {
        next.description = damageCase.description ?? ''
        setAttachments(damageCase.attachments ?? [])
      }
    }
    if (action === 'update_recovery' && damageCase) {
      // Default to the balance still to recover (earlier instalments already counted).
      const caseAmt = Number(damageCase.recovery?.amount) > 0 ? Number(damageCase.recovery.amount) : (Number(damageCase.assessedLoss) || 0)
      const bal = round2(Math.max(0, caseAmt - (Number(damageCase.recovery?.recoveredAmount) || 0)))
      next.recAmount = bal > 0 ? String(bal) : ''
    }
    if (action === 'return') next.condition = asset.status === 'DAMAGED' ? 'GOOD' : (asset.condition ?? 'GOOD')
    if (action === 'repair_complete') next.condition = 'GOOD'
    if (action === 'found') next.condition = asset.condition ?? 'GOOD'
    setF(next)
  }, [open, action, asset, damageCase, repairSent]) // eslint-disable-line react-hooks/exhaustive-deps

  // Labour Act cap for salary / cash recovery.
  const recoveryCap = maxRecoverable({ assessedLoss: Number(f.assessedLoss) || 0, liabilityPct: f.liabilityPct === '' ? 100 : Number(f.liabilityPct) })
  const employeeRecovery = EMPLOYEE_RECOVERY_METHODS.includes(f.recoveryMethod)
  const causeBlocksRecovery = employeeRecovery && NON_RECOVERABLE_CAUSES.includes(f.cause)

  if (!def || !asset) return null

  const isDisposal = ['sell', 'scrap', 'write_off', 'donate'].includes(action)
  const proceeds = action === 'sell' ? f.proceeds : action === 'scrap' ? f.proceeds : 0
  const showVat = (action === 'sell' || action === 'scrap') && Number(proceeds) > 0
  // Same rounding as the server: VAT rounded on its own, then added.
  const gross = showVat ? round2(round2(Number(proceeds)) + round2(Number(proceeds) * (Number(f.vatRate) || 0) / 100)) : 0
  const recNeedsAccount = action === 'update_recovery' && f.recStatus === 'RECOVERED' && ['CASH', 'INSURANCE'].includes(damageCase?.recovery?.method)
  // Recovery in instalments: case amount, recovered so far and the balance still due.
  const recCase = Number(damageCase?.recovery?.amount) > 0 ? Number(damageCase.recovery.amount) : (Number(damageCase?.assessedLoss) || 0)
  const recDone = Number(damageCase?.recovery?.recoveredAmount) || 0
  const recBalance = round2(Math.max(0, recCase - recDone))

  function body() {
    const b = { action, date, notes: notes.trim() || null, attachments }
    switch (action) {
      case 'assign':
      case 'reassign':
        return {
          ...b,
          employeeId: f.employee?.id ?? null,
          departmentId: f.departmentId || null,
          locationId: f.locationId || null,
          expectedReturnDate: f.expectedReturnDate || null,
          condition: f.condition || null,
        }
      case 'return':
        return { ...b, condition: f.condition || null, locationId: f.locationId || null }
      case 'transfer':
        return { ...b, locationId: f.locationId || null }
      case 'repair_send':
        return { ...b, vendorId: f.vendorId || null, vendorName: f.vendorId ? null : (f.vendorName || null), repairRef: f.repairRef || null, expectedDate: f.expectedDate || null }
      case 'repair_complete':
        return {
          ...b,
          cost: Number(f.cost) || 0,
          capitalize: Boolean(f.capitalize),
          payment: { mode: Number(f.cost) > 0 ? f.paymentMode : 'NONE', vatAmount: Number(f.vatAmount) || 0 },
          condition: f.condition || null,
          returnTo: f.returnTo || null,
          locationId: f.locationId || null,
          vendorId: f.vendorId || null,
          vendorName: f.vendorId ? null : (f.vendorName || null),
          repairRef: f.repairRef || null,
        }
      case 'report_damage':
        return {
          ...b,
          cause: f.cause || null,
          description: f.description.trim(),
          condition: f.condition || null,
          responsibleEmployeeId: f.responsible?.id ?? null,
          liabilityPct: f.liabilityPct === '' ? null : Number(f.liabilityPct),
          assessedLoss: f.assessedLoss === '' ? null : Number(f.assessedLoss),
          recovery: { method: f.recoveryMethod, amount: f.recoveryAmount === '' ? null : Number(f.recoveryAmount) },
          enquiryNote: f.enquiryNote.trim() || null,
          gdNumber: f.gdNumber.trim() || null,
          reportEventId: damageCase?.reportedByEmployee ? damageCase.eventId : null,
        }
      case 'update_recovery':
        return {
          ...b,
          eventId: damageCase?.eventId,
          status: f.recStatus,
          amount: f.recStatus === 'RECOVERED' ? Number(f.recAmount) || 0 : null,
          accountId: recNeedsAccount ? f.accountId : null,
          note: f.recNote.trim() || null,
        }
      case 'mark_lost':
      case 'mark_stolen':
        return { ...b, description: f.description.trim(), gdNumber: f.gdNumber.trim() || null }
      case 'found':
        return { ...b, locationId: f.locationId || null, condition: f.condition || null }
      case 'retire':
        return { ...b, reason: f.reason.trim() || null }
      case 'sell':
        return {
          ...b, buyerName: f.buyerName.trim(), buyerBin: f.buyerBin.trim() || null, proceeds: Number(f.proceeds) || 0,
          vatRate: Number(f.vatRate) || 0, accountId: gross > 0 ? f.accountId : null, reason: f.reason.trim() || null,
        }
      case 'scrap':
        return {
          ...b, reason: f.reason.trim(), scrapValue: Number(f.proceeds) || 0, buyerName: f.buyerName.trim() || null,
          buyerBin: f.buyerBin.trim() || null, vatRate: Number(f.vatRate) || 0, accountId: gross > 0 ? f.accountId : null,
        }
      case 'write_off':
        return { ...b, reason: f.reason.trim() }
      case 'donate':
        return { ...b, recipient: f.recipient.trim(), reason: f.reason.trim() }
      case 'adjust_value':
        return f.adjustMode === 'IMPAIRMENT'
          ? { ...b, impairment: Number(f.impairment) || 0, reason: f.reason.trim() }
          : { ...b, newCost: Number(f.newCost) || 0, reason: f.reason.trim() }
      default:
        return b
    }
  }

  function clientCheck() {
    switch (action) {
      case 'assign':
      case 'reassign':
        if (!f.employee && !f.departmentId) return 'Choose the employee (or department)'
        return null
      case 'transfer':
        if (!f.locationId) return 'Choose the new location'
        return null
      case 'report_damage':
        if (!f.cause) return 'Choose what caused the damage'
        if (f.description.trim().length < 3) return 'Describe the damage'
        if (employeeRecovery) {
          if (causeBlocksRecovery) return `${DAMAGE_CAUSE_LABELS[f.cause]} is not the employee's fault — choose another recovery method`
          if (!f.responsible) return 'Choose the employee responsible'
          if (!(Number(f.assessedLoss) > 0)) return 'Enter the assessed loss'
          if (f.enquiryNote.trim().length < 10) return 'Record the enquiry findings (at least 10 characters)'
          if (f.recoveryAmount !== '' && Number(f.recoveryAmount) > recoveryCap + 0.005) return `Recovery cannot exceed ${tk(recoveryCap)}`
        }
        return null
      case 'update_recovery':
        if (f.recStatus === 'RECOVERED' && !(Number(f.recAmount) > 0)) return 'Enter the amount recovered'
        if (f.recStatus === 'RECOVERED' && recCase > 0 && Number(f.recAmount) > recBalance + 0.005) return `The amount cannot exceed the balance still to recover (${tk(recBalance)})`
        if (recNeedsAccount && !f.accountId) return 'Choose the account the money went into'
        if (f.recStatus === 'WAIVED' && f.recNote.trim().length < 5) return 'Give the reason for waiving'
        return null
      case 'mark_lost':
      case 'mark_stolen':
        if (f.description.trim().length < 3) return 'Describe what happened'
        return null
      case 'sell':
        if (!f.buyerName.trim()) return 'Enter the buyer'
        if (f.proceeds === '' || !(Number(f.proceeds) >= 0)) return 'Enter the sale price'
        if (f.buyerBin.trim() && !isValidBin(f.buyerBin.trim())) return 'Buyer BIN must be 9 or 13 digits'
        if (gross > 0 && !f.accountId) return 'Choose the account the money went into'
        return null
      case 'scrap':
        if (f.reason.trim().length < 3) return 'Give the reason for scrapping'
        if (f.buyerBin.trim() && !isValidBin(f.buyerBin.trim())) return 'Buyer BIN must be 9 or 13 digits'
        if (gross > 0 && !f.accountId) return 'Choose the account the money went into'
        return null
      case 'write_off':
        if (f.reason.trim().length < 3) return 'Give the reason for the write-off'
        return null
      case 'donate':
        if (!f.recipient.trim()) return 'Who received the donation?'
        if (f.reason.trim().length < 3) return 'Give the reason'
        return null
      case 'adjust_value':
        if (f.reason.trim().length < 5) return 'Explain the adjustment (at least 5 characters)'
        if (f.adjustMode === 'IMPAIRMENT' && !(Number(f.impairment) > 0)) return 'Enter the impairment amount'
        if (f.adjustMode === 'COST' && !(Number(f.newCost) >= 0) ) return 'Enter the corrected cost'
        return null
      case 'note':
        if (notes.trim().length < 2) return 'Write the note'
        return null
      default:
        return null
    }
  }

  async function submit() {
    const msg = clientCheck()
    if (msg) { setError(msg); return }
    setError('')
    setSaving(true)
    try {
      const json = await apiJson(`/api/inventory/assets/${asset.id}/actions`, { method: 'POST', body: JSON.stringify(body()) })
      toast.success(`${def.title} — saved`)
      for (const w of json.warnings ?? []) toast(w, { duration: 7000 })
      if (['sell', 'scrap', 'update_recovery'].includes(action)) invalidateMoneyAccounts()
      if ((action === 'assign' || action === 'reassign') && f.printHandover && f.employee && json.event?.id) {
        openPrint(`/api/inventory/assets/${asset.id}/handover?eventId=${json.event.id}`)
      }
      onDone?.(json)
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const locationSelect = (label, { required = false, exclude = null, hint } = {}) => (
    <Field label={label} required={required} hint={hint}>
      <NativeSelect value={f.locationId} onChange={e => set({ locationId: e.target.value })}>
        <option value="">{required ? 'Select location' : `Keep current${asset.locationId?.name ? ` (${asset.locationId.name})` : ''}`}</option>
        {locations.filter(l => l.id !== exclude).map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>)}
      </NativeSelect>
    </Field>
  )

  const conditionSelect = (label = 'Condition') => (
    <Field label={label}>
      <NativeSelect value={f.condition} onChange={e => set({ condition: e.target.value })}>
        {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </Field>
  )

  const vendorFields = (
    <>
      <Field label="Repair vendor">
        <NativeSelect value={f.vendorId} onChange={e => set({ vendorId: e.target.value })}>
          <option value="">{vendors.length ? 'Other / in-house' : 'Type the name'}</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </NativeSelect>
      </Field>
      {!f.vendorId && (
        <Field label="Vendor / technician name">
          <Input value={f.vendorName} onChange={e => set({ vendorName: e.target.value })} placeholder="e.g. IT team, Apple service centre" />
        </Field>
      )}
      <Field label="Job / ticket no.">
        <Input value={f.repairRef} onChange={e => set({ repairRef: e.target.value })} />
      </Field>
    </>
  )

  const danger = def.tone === 'danger'
  const title = action === 'return' ? returnActionLabel(asset) : def.title
  const notesLabel = action === 'note' ? 'Note' : action === 'repair_send' ? 'Problem / issue' : 'Notes'

  return (
    <Modal open={open} onOpenChange={(v) => !saving && onOpenChange(v)} title={title}
      description={`${asset.assetTag} · ${asset.name} — ${STATUS_META[asset.status]?.label ?? asset.status}`}
      size={isDisposal || action === 'report_damage' ? 'lg' : 'md'}>
      <div className="space-y-4">
        {/* ── custody ── */}
        {(action === 'assign' || action === 'reassign') && (
          <>
            {action === 'reassign' && holder && <Notice>Currently with <b className="font-medium">{holder}</b>, who will be notified.</Notice>}
            <Field label="Employee">
              <PeoplePicker types={['EMPLOYEE']} value={f.employee} onChange={p => set({ employee: p })} placeholder="Search employees…" typeFilter={false} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Department" hint="For shared equipment">
                <NativeSelect value={f.departmentId} onChange={e => set({ departmentId: e.target.value })}>
                  <option value="">None</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </NativeSelect>
              </Field>
              {locationSelect('Location')}
              <Field label="Expected return"><DatePicker value={f.expectedReturnDate} onChange={v => set({ expectedReturnDate: v })} /></Field>
              {conditionSelect('Condition at hand-over')}
            </div>
            {f.employee && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="rounded border-gray-300" checked={f.printHandover} onChange={e => set({ printHandover: e.target.checked })} />
                Print hand-over form to sign
              </label>
            )}
          </>
        )}

        {action === 'return' && (
          <>
            {holder ? <Notice>Checking in from <b className="font-medium">{holder}</b>.</Notice> : <Notice>Assessed — goes back to stock.</Notice>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {conditionSelect('Condition on return')}
              {locationSelect('Return to location')}
            </div>
            {f.condition === 'BROKEN' && <Notice tone="warn">Returned broken — it will be marked <b className="font-medium">Damaged</b>. Use “Report damage” for a recovery case.</Notice>}
          </>
        )}

        {action === 'transfer' && locationSelect('New location', { required: true, exclude: refId(asset.locationId) })}

        {/* ── repairs ── */}
        {action === 'repair_send' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {vendorFields}
            <Field label="Expected back"><DatePicker value={f.expectedDate} onChange={v => set({ expectedDate: v })} /></Field>
          </div>
        )}

        {action === 'repair_complete' && (
          <>
            {repairSent && (
              <Notice>Sent on {fmtDay(repairSent.date)}{repairSent.vendorName ? ` to ${repairSent.vendorName}` : ''}{repairSent.repairRef ? ` (job ${repairSent.repairRef})` : ''}.</Notice>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Repair bill (incl. VAT)" hint="0 for warranty or free repairs">
                <Input type="number" min={0} step="0.01" inputMode="decimal" value={f.cost} onChange={e => set({ cost: e.target.value })} />
              </Field>
              <Field label="VAT in the bill">
                <Input type="number" min={0} step="0.01" inputMode="decimal" value={f.vatAmount} disabled={!(Number(f.cost) > 0)} onChange={e => set({ vatAmount: e.target.value })} />
              </Field>
              {conditionSelect('Condition after repair')}
              <Field label="Goes back to">
                <NativeSelect value={f.returnTo} onChange={e => set({ returnTo: e.target.value })}>
                  {hasHolder(asset) && <option value="ASSIGNED">{holder ?? 'Current holder'}</option>}
                  <option value="IN_STOCK">Stock</option>
                </NativeSelect>
              </Field>
              {locationSelect('Location')}
            </div>
            {Number(f.cost) > 0 && (
              <div className="space-y-2">
                <Label className="mb-0">Payment</Label>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="radio" className="mt-0.5" checked={f.paymentMode === 'REQUEST'} onChange={() => set({ paymentMode: 'REQUEST' })} />
                  <span>Send to Accounts as a payment request <span className="text-muted-foreground">(Repairs &amp; Maintenance)</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="radio" className="mt-0.5" checked={f.paymentMode === 'NONE'} onChange={() => set({ paymentMode: 'NONE' })} />
                  <span>Already paid / recorded elsewhere</span>
                </label>
                {canCapitalize && asset.isCapitalized !== false && (
                  <label className="flex items-start gap-2 text-sm text-gray-700 pt-1">
                    <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={f.capitalize} onChange={e => set({ capitalize: e.target.checked })} />
                    <span>Add to the asset cost (upgrade) <span className="block text-xs text-muted-foreground">Upgrades only (e.g. RAM/SSD) — ordinary repairs are expenses.</span></span>
                  </label>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{vendorFields}</div>
          </>
        )}

        {/* ── damage ── */}
        {action === 'report_damage' && (
          <>
            {damageCase?.reportedByEmployee && <Notice>Assessing the problem reported by the employee on {fmtDay(damageCase.date)}.</Notice>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Cause" required>
                <NativeSelect value={f.cause} onChange={e => set({ cause: e.target.value })}>
                  <option value="">Select cause</option>
                  {DAMAGE_CAUSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
              </Field>
              {conditionSelect('Condition now')}
              <Field label="What happened" required className="sm:col-span-2">
                <Textarea rows={2} value={f.description} onChange={e => set({ description: e.target.value })} placeholder="e.g. Screen cracked after the laptop fell from the desk" />
              </Field>
              <Field label="Assessed loss" hint="Repair estimate or value lost">
                <Input type="number" min={0} step="0.01" inputMode="decimal" value={f.assessedLoss} onChange={e => set({ assessedLoss: e.target.value })} />
              </Field>
              <Field label="Police GD no.">
                <Input value={f.gdNumber} onChange={e => set({ gdNumber: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-4 rounded-lg border border-gray-200/80 p-4">
              <h4 className="text-sm font-medium text-gray-900">Responsibility &amp; recovery</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Responsible employee">
                  <PeoplePicker types={['EMPLOYEE']} value={f.responsible} onChange={p => set({ responsible: p })} placeholder="Nobody / unknown" typeFilter={false} />
                </Field>
                <Field label="Recovery">
                  <NativeSelect value={f.recoveryMethod} onChange={e => set({ recoveryMethod: e.target.value })}>
                    {RECOVERY_METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </NativeSelect>
                </Field>
                {employeeRecovery && (
                  <>
                    <Field label="Employee's liability (%)">
                      <Input type="number" min={0} max={100} value={f.liabilityPct} placeholder="100" onChange={e => set({ liabilityPct: e.target.value })} />
                    </Field>
                    <Field label="Amount to recover" hint={`Max ${tk(recoveryCap)} (share of actual loss)`}>
                      <Input type="number" min={0} step="0.01" value={f.recoveryAmount} placeholder={String(recoveryCap)} onChange={e => set({ recoveryAmount: e.target.value })} />
                    </Field>
                    <Field label="Enquiry findings" required className="sm:col-span-2" hint="Who investigated, when, and the employee's response">
                      <Textarea rows={2} value={f.enquiryNote} onChange={e => set({ enquiryNote: e.target.value })} />
                    </Field>
                  </>
                )}
                {f.recoveryMethod === 'INSURANCE' && (
                  <Field label="Claim amount" hint="Defaults to the assessed loss">
                    <Input type="number" min={0} step="0.01" value={f.recoveryAmount} onChange={e => set({ recoveryAmount: e.target.value })} />
                  </Field>
                )}
              </div>
              {employeeRecovery && (
                <Notice tone={causeBlocksRecovery ? 'danger' : 'warn'}>
                  {causeBlocksRecovery
                    ? `${DAMAGE_CAUSE_LABELS[f.cause]} is not the employee's fault — wages cannot be deducted for it.`
                    : 'Labour Act 2006 s.125/127: deduct only for loss directly caused by the worker’s neglect or default, after a proper enquiry and a chance to explain, and never above the actual loss.'}
                </Notice>
              )}
            </div>
          </>
        )}

        {action === 'update_recovery' && damageCase && (
          <>
            <div className="space-y-0.5 rounded-lg bg-gray-50 px-3 py-2.5 text-sm">
              <p className="font-medium text-gray-900">{DAMAGE_CAUSE_LABELS[damageCase.cause] ?? 'Damage'} · {fmtDay(damageCase.date)}</p>
              <p className="text-gray-600">{damageCase.description}</p>
              <p className="text-xs text-muted-foreground">
                {RECOVERY_METHOD_LABELS[damageCase.recovery?.method] ?? '—'} · {tk(damageCase.recovery?.amount)}
                {damageCase.responsibleEmployeeName ? ` · ${damageCase.responsibleEmployeeName}` : ''}
              </p>
              {recDone > 0 && (
                <p className="text-xs text-muted-foreground">Recovered so far {tk(recDone)} · balance <b className="font-medium text-gray-900">{tk(recBalance)}</b></p>
              )}
            </div>
            <Tabs value={f.recStatus} onChange={v => set({ recStatus: v })}
              tabs={['RECOVERED', 'WAIVED'].map(s => ({ value: s, label: s === 'RECOVERED' ? 'Recovered' : 'Waive the balance' }))} />
            {f.recStatus === 'WAIVED' && (
              <Notice tone="warn">
                Waives the balance of {tk(recBalance)}{recDone > 0 ? ` — the ${tk(recDone)} already recovered stays on record` : ''}. The case is closed.
              </Notice>
            )}
            {f.recStatus === 'RECOVERED' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Amount recovered now" hint={recCase > 0 ? `Up to ${tk(recBalance)} · part payments keep it open` : null}>
                  <Input type="number" min={0} step="0.01" value={f.recAmount} onChange={e => set({ recAmount: e.target.value })} />
                </Field>
                {recNeedsAccount ? (
                  <Field label="Received into" required>
                    <MoneyAccountSelect currency="BDT" value={f.accountId} onChange={id => set({ accountId: id })} />
                  </Field>
                ) : (
                  <p className="self-end pb-2 text-xs text-muted-foreground">Deducted via payslip — nothing is posted here.</p>
                )}
              </div>
            )}
            <Field label={f.recStatus === 'WAIVED' ? 'Reason for waiving' : 'Note'} required={f.recStatus === 'WAIVED'}>
              <Textarea rows={2} value={f.recNote} onChange={e => set({ recNote: e.target.value })} />
            </Field>
          </>
        )}

        {/* ── lost / stolen / found / retire ── */}
        {(action === 'mark_lost' || action === 'mark_stolen') && (
          <>
            {holder && <Notice>{holder} currently holds it — custody stays in the history.</Notice>}
            <Field label="What happened" required>
              <Textarea rows={3} value={f.description} onChange={e => set({ description: e.target.value })} placeholder="Where and when it was last seen" />
            </Field>
            <Field label="Police GD no." hint={action === 'mark_stolen' ? 'Needed for insurance and the tax write-off' : null}>
              <Input value={f.gdNumber} onChange={e => set({ gdNumber: e.target.value })} />
            </Field>
          </>
        )}

        {action === 'found' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {locationSelect('Found at / now kept at')}
            {conditionSelect()}
          </div>
        )}

        {action === 'retire' && (
          <Field label="Reason" hint="Book depreciation continues while retired">
            <Input value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. Spare unit, replaced by newer model" />
          </Field>
        )}

        {/* ── disposals ── */}
        {(action === 'sell' || action === 'scrap') && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {action === 'scrap' && (
              <Field label="Reason" required className="sm:col-span-2">
                <Input value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. Motherboard failed, repair not economical" />
              </Field>
            )}
            <Field label={action === 'sell' ? 'Buyer' : 'Scrap buyer'} required={action === 'sell'}>
              <Input value={f.buyerName} onChange={e => set({ buyerName: e.target.value })} placeholder={action === 'scrap' ? 'Scrap buyer' : ''} />
            </Field>
            <Field label="Buyer BIN" hint="9 or 13 digits, if VAT registered">
              <Input className="font-mono" value={f.buyerBin} onChange={e => set({ buyerBin: e.target.value })} />
            </Field>
            <Field label={action === 'sell' ? 'Sale price (excl. VAT)' : 'Scrap proceeds (excl. VAT)'} required={action === 'sell'}>
              <Input type="number" min={0} step="0.01" inputMode="decimal" value={f.proceeds} onChange={e => set({ proceeds: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="VAT rate" hint={registered ? null : 'Company is not VAT registered'}>
              <NativeSelect value={f.vatRate} disabled={!registered || !(Number(f.proceeds) > 0)} onChange={e => set({ vatRate: e.target.value })}>
                {VAT_RATE_OPTIONS.map(r => <option key={r} value={String(r)}>{r}%</option>)}
              </NativeSelect>
            </Field>
            {gross > 0 && (
              <Field label={`Money received (${tk(gross)}) into`} required className="sm:col-span-2">
                <MoneyAccountSelect currency="BDT" value={f.accountId} onChange={id => set({ accountId: id })} />
              </Field>
            )}
            {action === 'sell' && (
              <Field label="Reason" className="sm:col-span-2">
                <Input value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. Upgraded; sold to staff" />
              </Field>
            )}
          </div>
        )}

        {action === 'write_off' && (
          <>
            <Field label="Reason" required>
              <Input value={f.reason} onChange={e => set({ reason: e.target.value })} list="wo-reasons" />
              <datalist id="wo-reasons">{WRITE_OFF_REASONS.map(r => <option key={r} value={r} />)}</datalist>
            </Field>
            {['LOST', 'STOLEN'].includes(asset.status) && <Notice tone="warn">Keep the search record or police GD on file — deductible only with evidence.</Notice>}
          </>
        )}

        {action === 'donate' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Recipient" required><Input value={f.recipient} onChange={e => set({ recipient: e.target.value })} placeholder="Organisation or person" /></Field>
            <Field label="Reason" required><Input value={f.reason} onChange={e => set({ reason: e.target.value })} /></Field>
          </div>
        )}

        {isDisposal && (
          <DisposalPreviewPanel asset={asset} kind={action} date={date} proceeds={proceeds} vatRate={showVat ? f.vatRate : 0}
            convention={convention} postToLedger={settings?.postDepreciationToLedger !== false} />
        )}

        {action === 'adjust_value' && (
          <>
            <Tabs value={f.adjustMode} onChange={v => set({ adjustMode: v })}
              tabs={[['IMPAIRMENT', 'Impairment (write-down)'], ['COST', 'Correct the cost']].map(([k, l]) => ({ value: k, label: l }))} />
            {f.adjustMode === 'IMPAIRMENT' ? (
              <>
                <Field label="Impairment amount" hint={`Book value ${tk(asset.bookValue)} · non-cash expense`}>
                  <Input type="number" min={0} step="0.01" value={f.impairment} onChange={e => set({ impairment: e.target.value })} />
                </Field>
                {Number(f.impairment) > 0 && <p className="text-sm text-muted-foreground">New book value <b className="font-semibold tabular-nums text-gray-900">{tk(round2((asset.bookValue ?? 0) - Number(f.impairment)))}</b></p>}
              </>
            ) : (
              <>
                <Field label="Corrected cost" hint={`Now ${tk(asset.cost)} · only before any depreciation or posting`}>
                  <Input type="number" min={0} step="0.01" value={f.newCost} onChange={e => set({ newCost: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Reason" required>
              <Input value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder={f.adjustMode === 'IMPAIRMENT' ? 'e.g. Obsolete model, market value fell' : 'e.g. Invoice amount was keyed wrongly'} />
            </Field>
          </>
        )}

        {/* ── common ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={def.money ? 'Accounting date' : 'Date'} hint={def.money && settings?.lockedUntil ? `Books are locked up to ${settings.lockedUntil}` : null}>
            <DatePicker value={date} onChange={v => setDate(v || todayKey())} clearable={false} />
          </Field>
        </div>
        <Field label={notesLabel} required={action === 'note'}>
          <Textarea rows={action === 'note' ? 4 : 2} value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>
        {action !== 'reactivate' && (
          <AttachmentsField value={attachments} onChange={setAttachments} label={action === 'report_damage' ? 'Photos & documents' : 'Attachments'} />
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </div>

      <ModalFooter className="sticky bottom-0 z-10">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button variant={danger ? 'destructive' : 'default'} onClick={submit} loading={saving}>
          {action === 'return' ? returnActionLabel(asset) : def.verb}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
