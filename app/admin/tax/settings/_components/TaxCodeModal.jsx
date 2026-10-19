'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import { taxCodeProblems, VAT_TREATMENTS, tdsRateText } from '@/lib/tax/catalog'
import { addDays } from '@/lib/finance/fiscal'
import { invalidateTaxCodesCache } from '@/components/tax/TaxCodeSelect'
import { readJson, todayKey } from '../../vat-return/_lib/format'

const TREATMENTS = VAT_TREATMENTS.filter(t => t.value !== 'NONE')

/** Next 1 July after today — Finance Acts take effect then. */
function nextJuly() {
  const t = todayKey()
  const y = Number(t.slice(0, 4))
  return t < `${y}-07-01` ? `${y}-07-01` : `${y + 1}-07-01`
}

const str = (v) => (v === null || v === undefined ? '' : String(v))

function blank(kind) {
  return {
    code: '', label: '', description: '',
    vatRate: '', vdsRate: '', treatment: 'STANDARD',
    section: '', basis: 'GROSS', rateCompany: '', rateIndividual: '', commissionRate: '', grossRate: '',
    effectiveFrom: todayKey(), effectiveTo: '', notes: '', isActive: true, kind,
  }
}

function fromRow(row) {
  return {
    code: str(row.code), label: str(row.label), description: str(row.description),
    vatRate: str(row.vatRate), vdsRate: str(row.vdsRate), treatment: row.treatment || 'STANDARD',
    section: str(row.section), basis: row.basis || 'GROSS',
    rateCompany: str(row.rateCompany), rateIndividual: str(row.rateIndividual),
    commissionRate: str(row.commissionRate), grossRate: str(row.grossRate),
    effectiveFrom: row.effectiveFromDay || '', effectiveTo: row.effectiveToDay || '',
    notes: str(row.notes), isActive: row.isActive !== false, kind: row.kind,
  }
}

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

/**
 * Create a custom code, edit a code, or add a new rate version of a code.
 * mode: 'create' | 'edit' | 'version'; row: the source code (edit / version).
 */
export default function TaxCodeModal({ open, mode, kind, row, onClose, onSaved }) {
  const [form, setForm] = useState(blank(kind))
  const [closePrevious, setClosePrevious] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'create') setForm(blank(kind))
    else if (mode === 'version' && row) setForm({ ...fromRow(row), effectiveFrom: nextJuly(), effectiveTo: '', isActive: true, notes: '' })
    else if (row) setForm(fromRow(row))
    setClosePrevious(true)
    setErrors({})
    setError(null)
  }, [open, mode, kind, row])

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const isVat = kind === 'VAT_SERVICE'
  const systemLocked = mode === 'edit' && row?.isSystem
  const codeLocked = mode === 'version' || systemLocked

  const payload = useMemo(() => {
    const base = {
      kind,
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      description: form.description.trim() || null,
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || null,
      notes: form.notes.trim() || null,
    }
    if (isVat) {
      return { ...base, vatRate: numOrNull(form.vatRate), vdsRate: numOrNull(form.vdsRate), treatment: form.treatment || null }
    }
    const commission = form.basis === 'COMMISSION_OR_GROSS'
    return {
      ...base,
      section: form.section.trim() || null,
      basis: form.basis,
      rateCompany: commission ? numOrNull(form.grossRate) : numOrNull(form.rateCompany),
      rateIndividual: commission ? numOrNull(form.grossRate) : numOrNull(form.rateIndividual),
      commissionRate: commission ? numOrNull(form.commissionRate) : null,
      grossRate: commission ? numOrNull(form.grossRate) : null,
    }
  }, [form, kind, isVat])

  function validate() {
    const errs = { ...taxCodeProblems(payload) }
    if (!payload.code) errs.code = 'Code is required'
    else if (!/^[A-Z0-9._-]+$/.test(payload.code)) errs.code = 'Use letters, digits, dot, dash or underscore'
    if (!payload.label) errs.label = 'Label is required'
    for (const f of ['vatRate', 'vdsRate', 'rateCompany', 'rateIndividual', 'commissionRate', 'grossRate']) {
      const v = payload[f]
      if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0 || v > 100)) errs[f] = 'Enter a rate between 0 and 100'
    }
    if (isVat && payload.vdsRate !== null && payload.vatRate !== null && payload.vdsRate > payload.vatRate) {
      errs.vdsRate = 'VDS cannot exceed the VAT rate'
    }
    if (mode === 'version' && row?.effectiveFromDay && payload.effectiveFrom <= row.effectiveFromDay) {
      errs.effectiveFrom = `Must be after ${row.effectiveFromDay} (the version you are replacing)`
    }
    return errs
  }

  async function save() {
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length) { setError(Object.values(errs)[0]); return }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'edit') {
        const body = { ...payload }
        delete body.kind
        if (systemLocked) { delete body.code; delete body.effectiveFrom }
        body.isActive = form.isActive
        const res = await fetch(`/api/tax/codes/${row.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        await readJson(res)
        toast.success('Tax code updated')
      } else {
        const body = { ...payload, isActive: true }
        if (mode === 'version' && Number.isFinite(Number(row?.sortOrder))) body.sortOrder = Number(row.sortOrder)
        const res = await fetch('/api/tax/codes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        await readJson(res)
        if (mode === 'version' && closePrevious && row?.id) {
          const closeOn = addDays(payload.effectiveFrom, -1)
          if (!row.effectiveToDay || row.effectiveToDay > closeOn) {
            try {
              const res2 = await fetch(`/api/tax/codes/${row.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effectiveTo: closeOn }),
              })
              await readJson(res2)
            } catch (err) {
              toast.error(`New version saved, but the old one couldn’t be closed: ${err.message}`)
            }
          }
        }
        toast.success(mode === 'version' ? `New rate version from ${payload.effectiveFrom} added` : 'Tax code added')
      }
      invalidateTaxCodesCache()
      onSaved?.()
    } catch (err) {
      const fieldErrs = err.details?.fieldErrors
      if (fieldErrs) setErrors(Object.fromEntries(Object.entries(fieldErrs).map(([k, v]) => [k, v?.[0]])))
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'create'
    ? (isVat ? 'Add VAT service code' : 'Add TDS section')
    : mode === 'version'
      ? `New rate version — ${row?.code ?? ''}`
      : `Edit ${row?.code ?? ''}`

  const rateInput = (k, label, hint) => (
    <Field label={label} hint={hint} error={errors[k]}>
      <div className="relative">
        <Input type="number" min="0" max="100" step="0.01" inputMode="decimal" className="pr-8 tabular-nums" invalid={!!errors[k]}
          value={form[k]} onChange={e => set({ [k]: e.target.value })} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
      </div>
    </Field>
  )

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v && !saving) onClose() }}
      title={title}
      description={mode === 'version'
        ? 'Starts on its effective date; past entries keep the old rate.'
        : (systemLocked ? 'Built-in: code and start date are fixed — use “New rate version” to change a rate.' : undefined)}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Code" required error={errors.code}>
            <Input className="font-mono uppercase" value={form.code} disabled={codeLocked} maxLength={32} invalid={!!errors.code}
              onChange={e => set({ code: e.target.value })} placeholder={isVat ? 'S099.10' : '90-OTHER'} />
          </Field>
          <Field label="Label" required error={errors.label} className="sm:col-span-2">
            <Input value={form.label} maxLength={200} invalid={!!errors.label} onChange={e => set({ label: e.target.value })} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} className="min-h-0 resize-none" value={form.description} maxLength={2000} onChange={e => set({ description: e.target.value })} />
        </Field>

        {isVat ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {rateInput('vatRate', 'VAT rate')}
            {rateInput('vdsRate', 'VDS rate', '0 = no VDS')}
            <Field label="Treatment" hint="Sets the Mushak-9.1 note">
              <NativeSelect value={form.treatment} onChange={e => set({ treatment: e.target.value })}>
                {TREATMENTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </NativeSelect>
            </Field>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Section (ITA 2023)" error={errors.section}>
                <Input value={form.section} maxLength={10} invalid={!!errors.section} onChange={e => set({ section: e.target.value })} placeholder="90" />
              </Field>
              <Field label="Basis" className="sm:col-span-2">
                <NativeSelect value={form.basis} onChange={e => set({ basis: e.target.value })}>
                  <option value="GROSS">Rate on the gross bill</option>
                  <option value="COMMISSION_OR_GROSS">Higher of a rate on commission or on the gross bill</option>
                </NativeSelect>
              </Field>
            </div>
            {form.basis === 'COMMISSION_OR_GROSS' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {rateInput('commissionRate', 'Rate on commission')}
                {rateInput('grossRate', 'Rate on gross bill')}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {rateInput('rateCompany', 'Rate — company / firm')}
                {rateInput('rateIndividual', 'Rate — individual')}
              </div>
            )}
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span className="font-medium text-gray-900">Preview:</span> {tdsRateText({ ...payload, code: payload.code })}. +50% if the payee has no PSR or isn’t paid through a bank (s.142).
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Effective from" error={errors.effectiveFrom}>
            <Input type="date" value={form.effectiveFrom} disabled={systemLocked} invalid={!!errors.effectiveFrom}
              onChange={e => set({ effectiveFrom: e.target.value })} />
          </Field>
          <Field label="Effective to" error={errors.effectiveTo}>
            <Input type="date" value={form.effectiveTo} min={form.effectiveFrom || undefined} invalid={!!errors.effectiveTo}
              onChange={e => set({ effectiveTo: e.target.value })} />
          </Field>
        </div>

        <Field label="Source / legal reference">
          <Textarea rows={2} className="min-h-0 resize-none" value={form.notes} maxLength={2000}
            onChange={e => set({ notes: e.target.value })} placeholder="e.g. SRO 273-Ain/Aykor-5/2026, Rule 4" />
        </Field>

        {mode === 'edit' && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.isActive} onChange={e => set({ isActive: e.target.checked })} />
            Active (offered in forms)
          </label>
        )}
        {mode === 'version' && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={closePrevious} onChange={e => setClosePrevious(e.target.checked)} />
            <span>End the {row?.effectiveFromDay} version the day before the new rate starts</span>
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving}>
          {mode === 'edit' ? 'Save changes' : mode === 'version' ? 'Add version' : 'Add code'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
