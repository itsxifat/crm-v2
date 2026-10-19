// Shared, pure helpers for the quotation pages (new / detail / list).
// `_components` is a private folder — never routed by Next.js.
import { CURRENCIES } from '@/lib/currencies'
import { VAT_TREATMENTS, VAT_RATE_OPTIONS } from '@/lib/tax/catalog'

export const blank = (v) => v === '' || v === null || v === undefined

export const curSymbol = (code) => CURRENCIES.find(c => c.code === (code || 'BDT'))?.symbol ?? code

export const money = (n) => (Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtMoney = (n, cur) => `${curSymbol(cur)} ${money(n)}`

export const QUOTATION_CURRENCIES = [
  { value: 'BDT', label: 'BDT (৳)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
]

export const STATUS_STYLES = {
  DRAFT:    { badge: 'bg-gray-100 text-gray-600',   label: 'Draft' },
  SENT:     { badge: 'bg-blue-100 text-blue-700',   label: 'Sent' },
  ACCEPTED: { badge: 'bg-green-100 text-green-700', label: 'Accepted' },
  REJECTED: { badge: 'bg-red-100 text-red-600',     label: 'Rejected' },
}

/** Treatments whose lines carry a VAT rate. */
export const RATED = ['STANDARD', 'REDUCED']

export const TREATMENT_HINTS = {
  STANDARD:   'Standard-rated supply — VAT is added on the value after discount.',
  REDUCED:    'Reduced rate, e.g. IT-enabled services (S099.10) at 5%.',
  ZERO_RATED: 'Export of services paid in foreign currency through a bank — VAT at 0%.',
  EXEMPT:     'Exempt supply — no VAT is charged.',
  NONE:       'Not a VAT quotation — prices are quoted without VAT lines.',
}

export const treatmentDefaultRate = (t) => VAT_TREATMENTS.find(x => x.value === t)?.defaultRate ?? 0

/**
 * VAT rates a treatment may carry — the rule lib/invoiceTotals enforces (and
 * InvoiceForm offers): STANDARD ⇒ 15% only (Mushak-9.1 note 4); REDUCED ⇒ a
 * rate above 0 and below 15% (note 7); ZERO_RATED / EXEMPT / NONE ⇒ 0.
 */
export const ratesFor = (t) => (t === 'STANDARD' ? [15]
  : t === 'REDUCED' ? VAT_RATE_OPTIONS.map(Number).filter(r => r > 0 && r < 15)
  : [0])

/** Lines whose own VAT % the treatment cannot carry fall back to the default (blank). */
export function clearDisallowedLineRates(items, treatment) {
  const allowed = ratesFor(treatment)
  const bad = (i) => !blank(i?.vatRate) && !allowed.includes(Number(i.vatRate))
  return items.some(bad) ? items.map(i => (bad(i) ? { ...i, vatRate: '' } : i)) : items
}

export const treatmentLabel = (t) => VAT_TREATMENTS.find(x => x.value === t)?.label ?? t

export const emptyItem = () => ({
  description: '', venture: '', service_category: '', service: '',
  quantity: 1, rate: '', amount: 0, vatRate: '',
})

/**
 * A stored quotation line → editable form row. Keeps any stored VAT inputs
 * (vatRate, sdRate, serviceCode); calculated VAT figures are recomputed live.
 */
export function toFormItem(item, categoryOf) {
  return {
    description:      item?.description ?? '',
    venture:          item?.venture ?? '',
    service_category: item?.service_category || (categoryOf ? categoryOf(item?.venture, item?.service) : '') || '',
    service:          item?.service ?? '',
    quantity:         item?.quantity ?? 1,
    rate:             item?.rate ?? '',
    amount:           Number(item?.amount ?? (Number(item?.quantity) || 0) * (Number(item?.rate) || 0)) || 0,
    vatRate:          blank(item?.vatRate) ? '' : item.vatRate,
    sdRate:           blank(item?.sdRate) || Number(item?.sdRate) === 0 ? '' : item.sdRate,
    serviceCode:      item?.serviceCode ?? null,
  }
}

/**
 * Form rows → request lines. Per-line VAT is sent only when "Different VAT per
 * line" is on for a rated treatment; a stored SD rate (API-entered) is kept.
 */
export function buildItemsPayload(items, { perLineVat = false, ratesOn = false } = {}) {
  return items.map(it => ({
    description:      it.description ?? '',
    venture:          it.venture || null,
    service_category: it.service_category || null,
    service:          it.service || null,
    quantity:         blank(it.quantity) ? it.quantity : Number(it.quantity),
    rate:             Number(it.rate) || 0,
    vatRate:          perLineVat && ratesOn && !blank(it.vatRate) ? Number(it.vatRate) : null,
    sdRate:           !blank(it.sdRate) && Number(it.sdRate) > 0 ? Number(it.sdRate) : null,
    serviceCode:      it.serviceCode || null,
  }))
}

/** The message to show for a failed API call ({ error } or zod { details }). */
export function apiErrorMessage(json, fallback = 'Something went wrong') {
  const d = json?.details
  if (d && typeof d === 'object') {
    const field = Object.values(d.fieldErrors ?? {}).flat().find(Boolean)
    const form  = (d.formErrors ?? []).find(Boolean)
    if (field || form) return field || form
  }
  return json?.error || fallback
}

/** fetch → JSON; throws an Error carrying the API's message when !res.ok. */
export async function fetchJson(url, options) {
  const res  = await fetch(url, options)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(apiErrorMessage(json, res.status === 403 ? 'You do not have permission to do that' : 'Request failed'))
  return json
}
