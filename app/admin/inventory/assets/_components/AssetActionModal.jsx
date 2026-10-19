'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Loader2, Scale, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import PeoplePicker from '@/components/ui/PeoplePicker'
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
  Field, inputCls, btnPrimary, btnSecondary, btnDanger, tk, todayKey, apiJson, useAssetOptions, holderName, refId,
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
    ? 'bg-amber-50 text-amber-800'
    : tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-800'
  const Icon = tone === 'info' ? Info : AlertTriangle
  return (
    <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed', cls)}>
      <Icon className="w-4 h-4 shrink-0 mt-px" />
      <div>{children}</div>
    </div>
  )
}

function PreviewRow({ label, value, strong, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-1">
      <span className="text-gray-500">{label}</span>
      <span className={cn('text-right', strong && 'font-semibold', tone === 'gain' && 'text-green-700', tone === 'loss' && 'text-red-600', !tone && 'text-gray-900')}>{value}</span>
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
    <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/60">
      <div className="flex items-center gap-2 mb-2">
        <Scale className="w-4 h-4 text-gray-500" />
        <h4 className="text-sm font-semibold text-gray-900">Effect on the books</h4>
      </div>
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
      <ul className="mt-3 space-y-1 text-xs text-gray-500 list-disc pl-4">
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
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      {(value ?? []).map((u, i) => (
        <div key={`${u}-${i}`} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1.5">
          <a href={u} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-blue-600 hover:underline">{u.split('/').pop()}</a>
          <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>
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
      <select className={inputCls} value={f.locationId} onChange={e => set({ locationId: e.target.value })}>
        <option value="">{required ? 'Select location' : `Keep current${asset.locationId?.name ? ` (${asset.locationId.name})` : ''}`}</option>
        {locations.filter(l => l.id !== exclude).map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>)}
      </select>
    </Field>
  )

  const conditionSelect = (label = 'Condition') => (
    <Field label={label}>
      <select className={inputCls} value={f.condition} onChange={e => set({ condition: e.target.value })}>
        {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )

  const vendorFields = (
    <>
      <Field label="Repair vendor">
        <select className={inputCls} value={f.vendorId} onChange={e => set({ vendorId: e.target.value })}>
          <option value="">{vendors.length ? 'Other / in-house' : 'Type the name →'}</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      {!f.vendorId && (
        <Field label="Vendor / technician name">
          <input className={inputCls} value={f.vendorName} onChange={e => set({ vendorName: e.target.value })} placeholder="e.g. IT team, Apple service centre" />
        </Field>
      )}
      <Field label="Job / ticket no.">
        <input className={inputCls} value={f.repairRef} onChange={e => set({ repairRef: e.target.value })} />
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
            {action === 'reassign' && holder && <Notice>Currently with <b>{holder}</b>. They will be notified of the hand-over.</Notice>}
            <Field label="Employee" hint="They get a notification to confirm receipt in My Assets">
              <PeoplePicker types={['EMPLOYEE']} value={f.employee} onChange={p => set({ employee: p })} placeholder="Search employees…" typeFilter={false} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Department (optional)" hint="For shared equipment">
                <select className={inputCls} value={f.departmentId} onChange={e => set({ departmentId: e.target.value })}>
                  <option value="">None</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              {locationSelect('Location')}
              <Field label="Expected return"><DatePicker value={f.expectedReturnDate} onChange={v => set({ expectedReturnDate: v })} /></Field>
              {conditionSelect('Condition at hand-over')}
            </div>
            {f.employee && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="rounded border-gray-300" checked={f.printHandover} onChange={e => set({ printHandover: e.target.checked })} />
                Open the hand-over form to print and sign
              </label>
            )}
          </>
        )}

        {action === 'return' && (
          <>
            {holder ? <Notice>Checking the asset back in from <b>{holder}</b>.</Notice> : <Notice>The asset has been assessed and goes back to stock.</Notice>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {conditionSelect('Condition on return')}
              {locationSelect('Return to location')}
            </div>
            {f.condition === 'BROKEN' && <Notice tone="warn">Returned broken: the asset will be marked <b>Damaged</b>. Use “Report damage” to start a recovery case if someone is responsible.</Notice>}
          </>
        )}

        {action === 'transfer' && locationSelect('New location', { required: true, exclude: refId(asset.locationId) })}

        {/* ── repairs ── */}
        {action === 'repair_send' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {vendorFields}
            <Field label="Expected back"><DatePicker value={f.expectedDate} onChange={v => set({ expectedDate: v })} /></Field>
          </div>
        )}

        {action === 'repair_complete' && (
          <>
            {repairSent && (
              <Notice>Sent on {fmtDay(repairSent.date)}{repairSent.vendorName ? ` to ${repairSent.vendorName}` : ''}{repairSent.repairRef ? ` (job ${repairSent.repairRef})` : ''}.</Notice>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Repair bill (incl. VAT)" hint="Leave 0 for warranty / free repairs">
                <input type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={f.cost} onChange={e => set({ cost: e.target.value })} />
              </Field>
              <Field label="VAT in the bill">
                <input type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={f.vatAmount} disabled={!(Number(f.cost) > 0)} onChange={e => set({ vatAmount: e.target.value })} />
              </Field>
              {conditionSelect('Condition after repair')}
              <Field label="Goes back to">
                <select className={inputCls} value={f.returnTo} onChange={e => set({ returnTo: e.target.value })}>
                  {hasHolder(asset) && <option value="ASSIGNED">{holder ?? 'Current holder'}</option>}
                  <option value="IN_STOCK">Stock</option>
                </select>
              </Field>
              {locationSelect('Location')}
            </div>
            {Number(f.cost) > 0 && (
              <div className="space-y-2">
                <span className="block text-xs font-medium text-gray-600">Payment</span>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="radio" className="mt-0.5" checked={f.paymentMode === 'REQUEST'} onChange={() => set({ paymentMode: 'REQUEST' })} />
                  <span>Send the bill to Accounts as a payment request <span className="text-gray-400">(Repairs &amp; Maintenance)</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="radio" className="mt-0.5" checked={f.paymentMode === 'NONE'} onChange={() => set({ paymentMode: 'NONE' })} />
                  <span>Already paid / recorded elsewhere</span>
                </label>
                {canCapitalize && asset.isCapitalized !== false && (
                  <label className="flex items-start gap-2 text-sm text-gray-700 pt-1">
                    <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={f.capitalize} onChange={e => set({ capitalize: e.target.checked })} />
                    <span>Add to the asset cost (upgrade) <span className="block text-xs text-gray-400">Only for work that improves or extends the asset (e.g. RAM/SSD upgrade) — ordinary repairs are expenses.</span></span>
                  </label>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{vendorFields}</div>
          </>
        )}

        {/* ── damage ── */}
        {action === 'report_damage' && (
          <>
            {damageCase?.reportedByEmployee && <Notice>Assessing the problem reported by the employee on {fmtDay(damageCase.date)}.</Notice>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Cause" required>
                <select className={inputCls} value={f.cause} onChange={e => set({ cause: e.target.value })}>
                  <option value="">Select cause</option>
                  {DAMAGE_CAUSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              {conditionSelect('Condition now')}
              <Field label="What happened" required className="sm:col-span-2">
                <textarea rows={2} className={inputCls} value={f.description} onChange={e => set({ description: e.target.value })} placeholder="e.g. Screen cracked after the laptop fell from the desk" />
              </Field>
              <Field label="Assessed loss" hint="Repair estimate or value lost">
                <input type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={f.assessedLoss} onChange={e => set({ assessedLoss: e.target.value })} />
              </Field>
              <Field label="Police GD no. (if any)">
                <input className={inputCls} value={f.gdNumber} onChange={e => set({ gdNumber: e.target.value })} />
              </Field>
            </div>
            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-900">Responsibility &amp; recovery</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Responsible employee">
                  <PeoplePicker types={['EMPLOYEE']} value={f.responsible} onChange={p => set({ responsible: p })} placeholder="Nobody / unknown" typeFilter={false} />
                </Field>
                <Field label="Recovery">
                  <select className={inputCls} value={f.recoveryMethod} onChange={e => set({ recoveryMethod: e.target.value })}>
                    {RECOVERY_METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                {employeeRecovery && (
                  <>
                    <Field label="Employee's share of liability (%)">
                      <input type="number" min={0} max={100} className={inputCls} value={f.liabilityPct} placeholder="100" onChange={e => set({ liabilityPct: e.target.value })} />
                    </Field>
                    <Field label="Amount to recover" hint={`Maximum ${tk(recoveryCap)} (share of the actual loss)`}>
                      <input type="number" min={0} step="0.01" className={inputCls} value={f.recoveryAmount} placeholder={String(recoveryCap)} onChange={e => set({ recoveryAmount: e.target.value })} />
                    </Field>
                    <Field label="Enquiry findings" required className="sm:col-span-2" hint="Who investigated, when, what the employee said">
                      <textarea rows={2} className={inputCls} value={f.enquiryNote} onChange={e => set({ enquiryNote: e.target.value })} />
                    </Field>
                  </>
                )}
                {f.recoveryMethod === 'INSURANCE' && (
                  <Field label="Claim amount" hint="Defaults to the assessed loss">
                    <input type="number" min={0} step="0.01" className={inputCls} value={f.recoveryAmount} onChange={e => set({ recoveryAmount: e.target.value })} />
                  </Field>
                )}
              </div>
              {employeeRecovery && (
                <Notice tone={causeBlocksRecovery ? 'danger' : 'warn'}>
                  {causeBlocksRecovery
                    ? `${DAMAGE_CAUSE_LABELS[f.cause]} is not the employee's fault — wages cannot be deducted for it.`
                    : 'Labour Act 2006 s.125/127: a deduction is allowed only for loss directly caused by the worker’s neglect or default, after a proper enquiry and a chance to explain, and never more than the actual loss. It is recorded in the damage register.'}
                </Notice>
              )}
            </div>
          </>
        )}

        {action === 'update_recovery' && damageCase && (
          <>
            <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-sm space-y-0.5">
              <p className="font-medium text-gray-900">{DAMAGE_CAUSE_LABELS[damageCase.cause] ?? 'Damage'} · {fmtDay(damageCase.date)}</p>
              <p className="text-gray-600">{damageCase.description}</p>
              <p className="text-xs text-gray-500">
                {RECOVERY_METHOD_LABELS[damageCase.recovery?.method] ?? '—'} · {tk(damageCase.recovery?.amount)}
                {damageCase.responsibleEmployeeName ? ` · ${damageCase.responsibleEmployeeName}` : ''}
              </p>
              {recDone > 0 && (
                <p className="text-xs text-gray-500">Recovered so far {tk(recDone)} · balance <b className="text-gray-700">{tk(recBalance)}</b></p>
              )}
            </div>
            <div className="flex gap-2">
              {['RECOVERED', 'WAIVED'].map(s => (
                <button key={s} type="button" onClick={() => set({ recStatus: s })}
                  className={cn('flex-1 rounded-lg border px-3 py-2 text-sm font-medium', f.recStatus === s ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50')}>
                  {s === 'RECOVERED' ? 'Recovered' : 'Waive the balance'}
                </button>
              ))}
            </div>
            {f.recStatus === 'WAIVED' && (
              <Notice tone="warn">
                Waives the balance of {tk(recBalance)}{recDone > 0 ? ` — the ${tk(recDone)} already recovered stays on record` : ''}. The case is closed.
              </Notice>
            )}
            {f.recStatus === 'RECOVERED' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Amount recovered now" hint={recCase > 0 ? `Up to ${tk(recBalance)} — a part payment keeps the case open for the rest` : null}>
                  <input type="number" min={0} step="0.01" className={inputCls} value={f.recAmount} onChange={e => set({ recAmount: e.target.value })} />
                </Field>
                {recNeedsAccount ? (
                  <Field label="Received into" required>
                    <MoneyAccountSelect currency="BDT" value={f.accountId} onChange={id => set({ accountId: id })} />
                  </Field>
                ) : (
                  <p className="text-xs text-gray-500 self-end pb-2">Salary deductions are taken through the payslip — no money is posted here.</p>
                )}
              </div>
            )}
            <Field label={f.recStatus === 'WAIVED' ? 'Reason for waiving' : 'Note'} required={f.recStatus === 'WAIVED'}>
              <textarea rows={2} className={inputCls} value={f.recNote} onChange={e => set({ recNote: e.target.value })} />
            </Field>
          </>
        )}

        {/* ── lost / stolen / found / retire ── */}
        {(action === 'mark_lost' || action === 'mark_stolen') && (
          <>
            {holder && <Notice>{holder} currently holds it — the custody record is kept in the history.</Notice>}
            <Field label="What happened" required>
              <textarea rows={3} className={inputCls} value={f.description} onChange={e => set({ description: e.target.value })} placeholder="Where and when it was last seen" />
            </Field>
            <Field label="Police GD no." hint={action === 'mark_stolen' ? 'Needed for insurance and the tax write-off' : 'If reported to the police'}>
              <input className={inputCls} value={f.gdNumber} onChange={e => set({ gdNumber: e.target.value })} />
            </Field>
          </>
        )}

        {action === 'found' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {locationSelect('Found at / now kept at')}
            {conditionSelect()}
          </div>
        )}

        {action === 'retire' && (
          <Field label="Reason" hint="The asset is kept but not used; book depreciation continues">
            <input className={inputCls} value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. Spare unit, replaced by newer model" />
          </Field>
        )}

        {/* ── disposals ── */}
        {(action === 'sell' || action === 'scrap') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {action === 'scrap' && (
              <Field label="Reason" required className="sm:col-span-2">
                <input className={inputCls} value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. Motherboard failed, repair not economical" />
              </Field>
            )}
            <Field label={action === 'sell' ? 'Buyer' : 'Scrap buyer'} required={action === 'sell'}>
              <input className={inputCls} value={f.buyerName} onChange={e => set({ buyerName: e.target.value })} placeholder={action === 'scrap' ? 'Scrap buyer' : ''} />
            </Field>
            <Field label="Buyer BIN" hint="13 digits, e.g. 000123456-0101 (if VAT registered)">
              <input className={cn(inputCls, 'font-mono')} value={f.buyerBin} onChange={e => set({ buyerBin: e.target.value })} />
            </Field>
            <Field label={action === 'sell' ? 'Sale price (excl. VAT)' : 'Scrap proceeds (excl. VAT)'} required={action === 'sell'}>
              <input type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={f.proceeds} onChange={e => set({ proceeds: e.target.value })} placeholder={action === 'scrap' ? '0 if nothing received' : ''} />
            </Field>
            <Field label="VAT rate" hint={registered ? 'Sale of a used asset is a taxable supply' : 'Company is not VAT registered'}>
              <select className={inputCls} value={f.vatRate} disabled={!registered || !(Number(f.proceeds) > 0)} onChange={e => set({ vatRate: e.target.value })}>
                {VAT_RATE_OPTIONS.map(r => <option key={r} value={String(r)}>{r}%</option>)}
              </select>
            </Field>
            {gross > 0 && (
              <Field label={`Money received (${tk(gross)}) into`} required className="sm:col-span-2">
                <MoneyAccountSelect currency="BDT" value={f.accountId} onChange={id => set({ accountId: id })} />
              </Field>
            )}
            {action === 'sell' && (
              <Field label="Reason (optional)" className="sm:col-span-2">
                <input className={inputCls} value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. Upgraded; sold to staff" />
              </Field>
            )}
          </div>
        )}

        {action === 'write_off' && (
          <>
            <Field label="Reason" required>
              <input className={inputCls} value={f.reason} onChange={e => set({ reason: e.target.value })} list="wo-reasons" />
              <datalist id="wo-reasons">{WRITE_OFF_REASONS.map(r => <option key={r} value={r} />)}</datalist>
            </Field>
            {['LOST', 'STOLEN'].includes(asset.status) && <Notice tone="warn">Keep the search record or police GD on file — the write-off is a deductible loss only with evidence.</Notice>}
          </>
        )}

        {action === 'donate' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Recipient" required><input className={inputCls} value={f.recipient} onChange={e => set({ recipient: e.target.value })} placeholder="Organisation or person" /></Field>
            <Field label="Reason" required><input className={inputCls} value={f.reason} onChange={e => set({ reason: e.target.value })} /></Field>
          </div>
        )}

        {isDisposal && (
          <DisposalPreviewPanel asset={asset} kind={action} date={date} proceeds={proceeds} vatRate={showVat ? f.vatRate : 0}
            convention={convention} postToLedger={settings?.postDepreciationToLedger !== false} />
        )}

        {action === 'adjust_value' && (
          <>
            <div className="flex gap-2">
              {[['IMPAIRMENT', 'Impairment (write-down)'], ['COST', 'Correct the cost']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => set({ adjustMode: k })}
                  className={cn('flex-1 rounded-lg border px-3 py-2 text-sm font-medium', f.adjustMode === k ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50')}>
                  {l}
                </button>
              ))}
            </div>
            {f.adjustMode === 'IMPAIRMENT' ? (
              <>
                <Field label="Impairment amount" hint={`Book value now ${tk(asset.bookValue)} — posted as a non-cash expense`}>
                  <input type="number" min={0} step="0.01" className={inputCls} value={f.impairment} onChange={e => set({ impairment: e.target.value })} />
                </Field>
                {Number(f.impairment) > 0 && <p className="text-sm text-gray-600">New book value: <b>{tk(round2((asset.bookValue ?? 0) - Number(f.impairment)))}</b></p>}
              </>
            ) : (
              <>
                <Field label="Corrected cost" hint={`Current cost ${tk(asset.cost)} — only to fix a wrong entry before any depreciation or ledger posting`}>
                  <input type="number" min={0} step="0.01" className={inputCls} value={f.newCost} onChange={e => set({ newCost: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Reason" required>
              <input className={inputCls} value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder={f.adjustMode === 'IMPAIRMENT' ? 'e.g. Obsolete model, market value fell' : 'e.g. Invoice amount was keyed wrongly'} />
            </Field>
          </>
        )}

        {/* ── common ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Date" hint={def.money ? (settings?.lockedUntil ? `Books are locked up to ${settings.lockedUntil}` : 'Accounting date of the entries') : null}>
            <DatePicker value={date} onChange={v => setDate(v || todayKey())} clearable={false} />
          </Field>
        </div>
        <Field label={notesLabel} required={action === 'note'}>
          <textarea rows={action === 'note' ? 4 : 2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>
        {action !== 'reactivate' && (
          <AttachmentsField value={attachments} onChange={setAttachments} label={action === 'report_damage' ? 'Photos & documents' : 'Attachments'} />
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </div>

      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5 sticky bottom-0 z-10">
        <button type="button" className={btnSecondary} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button type="button" className={danger ? btnDanger : btnPrimary} onClick={submit} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {action === 'return' ? returnActionLabel(asset) : def.verb}
        </button>
      </ModalFooter>
    </Modal>
  )
}
