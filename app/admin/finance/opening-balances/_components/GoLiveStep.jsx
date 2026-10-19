'use client'

import { useEffect, useMemo, useState } from 'react'
import { Info, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { Field, NativeSelect } from '@/components/ui/Input'
import { addDays, dayKeyLabel, fiscalYearOf, periodLabel, taxPeriodOf } from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { MONTH_OPTIONS } from '../_lib/meta'
import { Callout, Guidance, apiFetch, fieldErrorsOf } from './shared'

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
      for (const w of json.warnings ?? []) toast(w, { icon: <Info className="size-4 shrink-0 text-blue-600" />, duration: 6000 })
      onSaved?.()
    } catch (err) {
      setErrors(fieldErrorsOf(err))
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <CardTitle as="h2">Go-live date &amp; fiscal year</CardTitle>

      <Guidance
        what="The first day every payment, receipt and tax entry is recorded here. Opening figures are balances at the end of the day before."
        where="Ideally the 1st of a month — 1 July, or the day after the last VAT return you filed outside the CRM."
      />

      {locked && (
        <Callout tone="neutral" title="Opening balances are locked">
          Only a super admin can unlock them (step 5).
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Go-live date" error={errors.goLiveDate}>
          <DatePicker value={goLive} onChange={setGoLive} disabled={readOnly} placeholder="Select…" />
        </Field>
        <Field label="Fiscal year starts" htmlFor="fy-start" hint="July for most BD companies" error={errors.fiscalYearStartMonth}>
          <NativeSelect
            id="fy-start"
            value={fyMonth}
            disabled={readOnly}
            onChange={e => setFyMonth(Number(e.target.value))}
          >
            {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </NativeSelect>
        </Field>
      </div>

      {derived && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Balances as at</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-900">End of {dayKeyLabel(derived.asOf)}</p>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Income year</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-900">FY {derived.fy}</p>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">First VAT period</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-900">{derived.firstVat}</p>
          </div>
        </div>
      )}

      {derived && !derived.monthStart && (
        <Callout tone="warning">Go-live isn&apos;t the 1st of a month — statements and VAT returns won&apos;t line up as easily.</Callout>
      )}
      {derived?.future && (
        <Callout tone="info">Go-live is in the future — prepare now and lock once the day arrives.</Callout>
      )}
      {fyMonth !== 7 && (
        <Callout tone="info">Income-tax, advance tax and withholding returns still follow your income year.</Callout>
      )}
      {derived && (
        <Callout tone="neutral">
          From {dayKeyLabel(goLive)}, every money entry must name its bank, cash or wallet account.
        </Callout>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <Button loading={saving} disabled={!dirty || !goLive} onClick={save}>
            {!saving && <Save />}
            Save
          </Button>
        </div>
      )}
    </Card>
  )
}
