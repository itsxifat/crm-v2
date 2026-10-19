'use client'

import { useMemo } from 'react'
import { Receipt, Loader2, Info, AlertTriangle } from 'lucide-react'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { VAT_TREATMENTS } from '@/lib/tax/catalog'
import { TREATMENT_HINTS, ratesFor } from './quotationUi'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const hintCls  = 'text-xs text-gray-400 mt-1'

function Note({ tone = 'info', children }) {
  const cls = tone === 'warn'
    ? 'text-amber-700 bg-amber-50'
    : tone === 'muted' ? 'text-gray-500 bg-gray-50' : 'text-blue-700 bg-blue-50'
  const Icon = tone === 'warn' ? AlertTriangle : Info
  return (
    <p className={`flex items-start gap-1.5 text-xs rounded-lg px-3 py-2 ${cls}`}>
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
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
    <div className={`bg-white border border-gray-100 rounded-xl p-5 space-y-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Receipt className="w-4 h-4 text-gray-400" /> VAT
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">How VAT applies to this quote. The invoice raised from it should use the same setup.</p>
        </div>
        {loading && !isEdit && (
          <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading defaults…
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="q-vat-treatment">VAT treatment</label>
          <select id="q-vat-treatment" value={vatTreatment ?? ''} onChange={e => changeTreatment(e.target.value || 'NONE')}
            className={inputCls}>
            {!vatTreatment && <option value="">Company default (applied on save)</option>}
            {VAT_TREATMENTS.map(t => (
              <option key={t.value} value={t.value} disabled={notRegistered && t.value !== 'NONE'}>{t.label}</option>
            ))}
          </select>
          <p className={hintCls}>
            {vatTreatment
              ? TREATMENT_HINTS[vatTreatment]
              : 'The company’s default VAT treatment (Tax & VAT → Tax Settings) is applied when you save.'}
          </p>
        </div>

        {ratesOn && (
          <div>
            <label className={labelCls} htmlFor="q-vat-rate">{perLineVat ? 'Default VAT rate' : 'VAT rate'}</label>
            <select id="q-vat-rate" value={String(defaultVatRate ?? '')} onChange={e => changeRate(e.target.value)} className={inputCls}>
              {rateOptions.map(r => <option key={r} value={String(r)}>{r}%</option>)}
            </select>
            <p className={hintCls}>
              {perLineVat ? 'Used for lines without their own VAT %.'
                : effectiveTreatment === 'REDUCED' ? 'Applied to every line. Turn on “Different VAT per line” to mix reduced rates.'
                : 'Applied to every line. For a reduced rate (e.g. ITES 5%) choose the “Reduced rate” treatment.'}
            </p>
          </div>
        )}

        {isVat && (
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="q-vat-service">Service code</label>
            <TaxCodeSelect
              id="q-vat-service"
              kind="VAT_SERVICE"
              value={serviceCode || null}
              onChange={changeServiceCode}
              placeholder="Select service code (e.g. S099.10)"
            />
            <p className={hintCls}>Picking a code sets its VAT rate.</p>
          </div>
        )}
      </div>

      {ratesOn && (
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={perLineVat} onChange={e => togglePerLineVat(e.target.checked, setItems)}
            className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
          Different VAT per line
        </label>
      )}

      <div className="space-y-2">
        {notRegistered && (
          <Note tone="warn">
            The company is set up as {registrationType === 'TURNOVER' ? 'a turnover-tax enterprise' : 'not VAT registered'}, so quotations cannot carry VAT.
          </Note>
        )}
        {isVat && foreignClient && effectiveTreatment !== 'ZERO_RATED' && (
          <Note>This is a foreign client — export of services paid in foreign currency through a bank is usually zero-rated.</Note>
        )}
        {isVat && !foreignClient && currency !== 'BDT' && ratesOn && (
          <Note>This quote is in {currency}. Services exported for foreign currency are usually zero-rated.</Note>
        )}
        {isVat && sourceType === 'CLIENT' && clientInfo && !clientInfo.hasBin && !foreignClient && ratesOn && (
          <Note tone="warn">This client has no BIN on file. Add it on the client profile — the tax invoice (Mushak-6.3) needs it.</Note>
        )}
        {isVat && sourceType === 'CLIENT' && clientInfo?.bin && (
          <p className="text-xs text-gray-500">Client BIN: <span className="font-medium text-gray-700">{clientInfo.bin}</span> — printed on the quote.</p>
        )}
        {isVat && sourceType === 'LEAD' && (
          <p className="text-xs text-gray-400">Leads have no BIN on file. Once the lead becomes a client, add their BIN on the client profile.</p>
        )}
        {!isEdit && vatInfoState === 'failed' && !vatTreatment && (
          <Note tone="muted">Couldn’t load the company’s VAT defaults. They will be applied when you save, or pick a treatment above.</Note>
        )}
      </div>
    </div>
  )
}
