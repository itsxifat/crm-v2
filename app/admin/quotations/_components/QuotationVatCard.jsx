'use client'

import { useMemo } from 'react'
import { Loader2, Info, AlertTriangle } from 'lucide-react'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/Card'
import { Field, NativeSelect, selectClass } from '@/components/ui/Input'
import { VAT_TREATMENTS } from '@/lib/tax/catalog'
import { cn } from '@/lib/utils'
import { TREATMENT_HINTS, ratesFor } from './quotationUi'

function Note({ tone = 'info', children }) {
  const cls = tone === 'warn'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : tone === 'muted' ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-blue-200 bg-blue-50 text-blue-800'
  const Icon = tone === 'warn' ? AlertTriangle : Info
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm', cls)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'muted' && 'text-gray-500')} />
      <span>{children}</span>
    </p>
  )
}

/**
 * VAT card for the quotation forms: treatment, (default) VAT rate, service
 * code (sets its rate), "Different VAT per line" toggle and context hints.
 *
 *   vat         the useQuotationVat() object
 *   setItems    form items setter (seeds per-line rates when the toggle turns on)
 *   isEdit      editing a stored quotation (no "company default" state)
 *   sourceType  'LEAD' | 'CLIENT'
 *   currency    quotation currency
 */
export default function QuotationVatCard({ vat, setItems, isEdit = false, sourceType = 'CLIENT', currency = 'BDT', className = '' }) {
  const {
    vatTreatment, effectiveTreatment, isVat, ratesOn, defaultVatRate, serviceCode, perLineVat,
    vatInfoState, registrationType, notRegistered, clientInfo,
    changeTreatment, changeRate, changeServiceCode, togglePerLineVat,
  } = vat

  // Rates the treatment may carry (STANDARD 15%, REDUCED 0–15% exclusive) — a
  // stored out-of-range rate stays visible so the validation message makes sense.
  const rateOptions = useMemo(() => {
    const set = new Set(ratesFor(effectiveTreatment))
    if (Number.isFinite(Number(defaultVatRate))) set.add(Number(defaultVatRate))
    return [...set].sort((a, b) => a - b)
  }, [defaultVatRate, effectiveTreatment])

  const loading = vatInfoState === 'loading'
  const foreignClient = clientInfo?.vatRegistrationType === 'FOREIGN'

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle title="How VAT applies to this quote. The invoice raised from it should use the same setup.">VAT</CardTitle>
        {loading && !isEdit && (
          <CardAction className="text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Loading defaults…
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="VAT treatment"
            htmlFor="q-vat-treatment"
            hint={vatTreatment ? TREATMENT_HINTS[vatTreatment] : 'Company default applied on save'}
          >
            <NativeSelect id="q-vat-treatment" value={vatTreatment ?? ''} onChange={e => changeTreatment(e.target.value || 'NONE')}>
              {!vatTreatment && <option value="">Company default</option>}
              {VAT_TREATMENTS.map(t => (
                <option key={t.value} value={t.value} disabled={notRegistered && t.value !== 'NONE'}>{t.label}</option>
              ))}
            </NativeSelect>
          </Field>

          {ratesOn && (
            <Field
              label={perLineVat ? 'Default VAT rate' : 'VAT rate'}
              htmlFor="q-vat-rate"
              hint={perLineVat ? 'For lines without their own rate'
                : effectiveTreatment === 'REDUCED' ? 'Applies to every line'
                : 'For ITES 5%, pick “Reduced rate”'}
            >
              <NativeSelect id="q-vat-rate" value={String(defaultVatRate ?? '')} onChange={e => changeRate(e.target.value)}>
                {rateOptions.map(r => <option key={r} value={String(r)}>{r}%</option>)}
              </NativeSelect>
            </Field>
          )}

          {isVat && (
            <Field label="Service code" htmlFor="q-vat-service" hint="Sets the VAT rate" className="sm:col-span-2">
              <TaxCodeSelect
                id="q-vat-service"
                kind="VAT_SERVICE"
                value={serviceCode || null}
                onChange={changeServiceCode}
                placeholder="e.g. S099.10"
                className={selectClass}
              />
            </Field>
          )}
        </div>

        {ratesOn && (
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={perLineVat} onChange={e => togglePerLineVat(e.target.checked, setItems)}
              className="size-4 rounded border-gray-300" />
            Different VAT per line
          </label>
        )}

        <div className="space-y-2 empty:hidden">
          {notRegistered && (
            <Note tone="warn">
              Company is {registrationType === 'TURNOVER' ? 'a turnover-tax enterprise' : 'not VAT registered'} — quotations can’t carry VAT.
            </Note>
          )}
          {isVat && foreignClient && effectiveTreatment !== 'ZERO_RATED' && (
            <Note>Foreign client — exports paid in FX through a bank are usually zero-rated.</Note>
          )}
          {isVat && !foreignClient && currency !== 'BDT' && ratesOn && (
            <Note>Quoted in {currency} — services exported for FX are usually zero-rated.</Note>
          )}
          {isVat && sourceType === 'CLIENT' && clientInfo && !clientInfo.hasBin && !foreignClient && ratesOn && (
            <Note tone="warn">Client has no BIN on file — the Mushak-6.3 needs it. Add it on the client profile.</Note>
          )}
          {isVat && sourceType === 'CLIENT' && clientInfo?.bin && (
            <p className="text-xs text-muted-foreground">Client BIN <span className="font-medium text-gray-900">{clientInfo.bin}</span> — printed on the quote</p>
          )}
          {isVat && sourceType === 'LEAD' && (
            <p className="text-xs text-muted-foreground">Leads have no BIN — add it once they become a client.</p>
          )}
          {!isEdit && vatInfoState === 'failed' && !vatTreatment && (
            <Note tone="muted">Couldn’t load VAT defaults — they’ll apply on save, or pick a treatment.</Note>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
