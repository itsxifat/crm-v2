'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Loader2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import DatePicker from '@/components/ui/DatePicker'
import { addDays, dayKeyLabel, fiscalYearOf, periodLabel, taxPeriodOf } from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { MONTH_OPTIONS } from '../_lib/meta'
import { Callout, FieldError, Guidance, apiFetch, btnPrimary, cardCls, fieldErrorsOf, inputCls, labelCls } from './shared'

export default function GoLiveStep({ data, canEdit, onSaved }) {
  const locked = data.openingLocked
  const [goLive, setGoLive] = useState(data.goLiveDate ?? null)
  const [fyMonth, setFyMonth] = useState(Number(data.settings?.fiscalYearStartMonth) || 7)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    setGoLive(data.goLiveDate ?? null)
    setFyMonth(Number(data.settings?.fiscalYearStartMonth) || 7)
  }, [data.goLiveDate, data.settings?.fiscalYearStartMonth])

  const dirty = (goLive ?? null) !== (data.goLiveDate ?? null) || fyMonth !== (Number(data.settings?.fiscalYearStartMonth) || 7)
  const readOnly = !canEdit || locked

  const derived = useMemo(() => {
    if (!goLive) return null
    return {
      asOf:      addDays(goLive, -1),
      fy:        fiscalYearOf(goLive, fyMonth),
      firstVat:  periodLabel(taxPeriodOf(goLive)),
      monthStart: goLive.endsWith('-01'),
      future:    goLive > dhakaDayKey(new Date()),
    }
  }, [goLive, fyMonth])

  async function save() {
    setSaving(true)
    setErrors({})
    try {
      const json = await apiFetch('/api/finance/settings', {
        method: 'PUT',
        body: { goLiveDate: goLive || null, fiscalYearStartMonth: fyMonth },
      })
      toast.success('Go-live settings saved')
      for (const w of json.warnings ?? []) toast(w, { icon: 'ℹ️', duration: 6000 })
      onSaved?.()
    } catch (err) {
      setErrors(fieldErrorsOf(err))
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${cardCls} p-4 sm:p-6 space-y-5`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <CalendarCheck className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Step 1 — Go-live date & fiscal year</h2>
          <p className="text-sm text-gray-500">The day the CRM becomes your book of record.</p>
        </div>
      </div>

      <Guidance
        what="The first day every payment, receipt and tax entry is recorded here. Each opening figure in the next steps is the balance at the end of the day before it."
        where="Choose the 1st of a month — ideally 1 July (start of the income year), or the first day after the last VAT return you filed outside the CRM, so that return's closing balance carries straight in."
      />

      {locked && (
        <Callout tone="neutral" title="Opening balances are locked">
          The go-live date and fiscal year can only change after a super admin unlocks the opening balances (step 5).
        </Callout>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Go-live date</label>
          <DatePicker value={goLive} onChange={setGoLive} disabled={readOnly} placeholder="Pick the first day in the CRM" />
          <FieldError message={errors.goLiveDate} />
        </div>
        <div>
          <label className={labelCls} htmlFor="fy-start">Fiscal (income) year starts in</label>
          <select
            id="fy-start"
            className={inputCls}
            value={fyMonth}
            disabled={readOnly}
            onChange={e => setFyMonth(Number(e.target.value))}
          >
            {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Bangladesh companies use July–June. Banks and insurers use January–December.</p>
          <FieldError message={errors.fiscalYearStartMonth} />
        </div>
      </div>

      {derived && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-gray-100 px-3 py-2.5">
            <p className="text-[11px] text-gray-500">Opening balances are as at</p>
            <p className="text-sm font-semibold text-gray-900">End of {dayKeyLabel(derived.asOf)}</p>
          </div>
          <div className="rounded-lg border border-gray-100 px-3 py-2.5">
            <p className="text-[11px] text-gray-500">Income year at go-live</p>
            <p className="text-sm font-semibold text-gray-900">FY {derived.fy}</p>
          </div>
          <div className="rounded-lg border border-gray-100 px-3 py-2.5">
            <p className="text-[11px] text-gray-500">First VAT period in the CRM</p>
            <p className="text-sm font-semibold text-gray-900">{derived.firstVat}</p>
          </div>
        </div>
      )}

      {derived && !derived.monthStart && (
        <Callout tone="warning" title="Go-live is not the 1st of a month">
          This works, but bank statements and VAT returns line up far more easily when go-live is a month start.
        </Callout>
      )}
      {derived?.future && (
        <Callout tone="info">Go-live is in the future — you can prepare the opening balances now and lock them once the day arrives.</Callout>
      )}
      {fyMonth !== 7 && (
        <Callout tone="info">You chose a fiscal year that does not start in July. Income-tax returns, advance tax and withholding returns still follow your income year.</Callout>
      )}
      {derived && (
        <Callout tone="neutral">
          From {dayKeyLabel(goLive)} every new money entry must say which bank, cash or wallet account it went through.
        </Callout>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <button type="button" className={btnPrimary} disabled={saving || !dirty || !goLive} onClick={save}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save go-live settings
          </button>
        </div>
      )}
    </div>
  )
}
