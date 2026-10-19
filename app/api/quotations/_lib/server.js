/**
 * Server-only helpers shared by the /api/quotations routes.
 *
 * `_lib` is a private folder (never routed by Next.js). These used to live in
 * lib/quotation.js; they moved here so that module stays pure (it is imported
 * by the quotation pages in the browser and by plain Node scripts).
 */
import { z } from 'zod'
import { canDo } from '@/lib/rbac'
import { maskDoc, QUOTATION_PII } from '@/lib/pii'
import { getFinanceSettings } from '@/lib/finance/settings'
import { VAT_TREATMENTS, BIN_REGEX, normalizeBin } from '@/lib/tax/catalog'
import { QUOTATION_VAT_TREATMENTS, uniformVatRate, normaliseVatTreatment } from '@/lib/quotation'

/**
 * Populate spec for quotation responses. Only names are exposed for the linked
 * lead / client / creator — contact details are never populated here (the
 * recipient snapshot on the quotation itself is masked via QUOTATION_PII).
 * The client's BIN fields are read only to derive `buyerBin`; the legacy
 * `vatNumber` is removed from the response again in quotationJSON().
 */
export const QUOTATION_POPULATE = [
  { path: 'leadId',    select: 'name company' },
  { path: 'clientId',  select: 'company contactPerson bin vatNumber vatRegistrationType', populate: { path: 'userId', select: 'name' } },
  { path: 'createdBy', select: 'name avatar' },
]

const isBlank = (v) => v === undefined || v === null || v === ''

/** A populated sub-document (not a bare ObjectId). */
const isPopulated = (v) => !!v && typeof v === 'object' && typeof v.toHexString !== 'function'

/**
 * The client's BIN for printing: Client.bin, else a legacy `vatNumber` that is
 * shaped like a BIN. The legacy field is identity-masked (CLIENT_PII), so it is
 * only used for callers allowed to see it. A masked value is never returned.
 */
export function clientBinFor(session, client) {
  if (!client) return null
  const bin = client.bin ? String(client.bin).trim() : ''
  if (bin && !bin.includes('••')) return bin
  if (!canDo(session, 'pii.identity.view')) return null
  const legacy = client.vatNumber ? String(client.vatNumber).replace(/\s/g, '') : ''
  return legacy && !legacy.includes('••') && BIN_REGEX.test(legacy) ? normalizeBin(legacy) : null
}

/**
 * Serialise a hydrated quotation document for a staff response (PII-masked).
 * Adds `buyerBin` (client-sourced quotations only; null when unknown) and never
 * exposes the client's legacy VAT number.
 */
export function quotationJSON(session, doc) {
  const json = doc.toJSON()
  const client = isPopulated(json.clientId) ? json.clientId : null
  json.buyerBin = json.sourceType === 'CLIENT' ? clientBinFor(session, client) : null
  if (client) delete client.vatNumber
  return maskDoc(session, json, QUOTATION_PII)
}

// ── VAT setup ────────────────────────────────────────────────────────────────

/** settings.vat, or null when finance settings cannot be read (legacy behaviour then applies). */
export async function loadVatSettings() {
  try {
    const settings = await getFinanceSettings()
    return settings?.vat ?? null
  } catch (err) {
    console.error('[api/quotations] finance settings unavailable', err)
    return null
  }
}

/** Rate a treatment implies when none is given (company default rate for the company default treatment). */
export function defaultRateFor(treatment, vat) {
  if (vat && treatment === vat.defaultSalesTreatment && Number.isFinite(Number(vat.defaultSalesRate)))
    return Number(vat.defaultSalesRate)
  return VAT_TREATMENTS.find(t => t.value === treatment)?.defaultRate ?? 0
}

/**
 * Default VAT setup for a NEW quotation (same rules as invoices):
 *   - company not VAT registered (turnover / unregistered) → NONE
 *   - foreign client → ZERO_RATED (export of services)
 *   - otherwise finance settings vat.defaultSalesTreatment (+ rate + service code)
 * With no readable settings the legacy behaviour (no VAT) applies.
 */
export function vatDefaultsFor(vat, client) {
  if (!vat || vat.registrationType !== 'REGISTERED')
    return { vatTreatment: 'NONE', vatRate: 0, serviceCode: null }
  if (client?.vatRegistrationType === 'FOREIGN')
    return { vatTreatment: 'ZERO_RATED', vatRate: 0, serviceCode: vat.defaultServiceCode ?? null }
  const treatment = QUOTATION_VAT_TREATMENTS.includes(vat.defaultSalesTreatment) ? vat.defaultSalesTreatment : 'NONE'
  return {
    vatTreatment: treatment,
    vatRate:      treatment === 'NONE' ? 0 : defaultRateFor(treatment, vat),
    serviceCode:  treatment === 'NONE' ? null : (vat.defaultServiceCode ?? null),
  }
}

/**
 * Request-body VAT fields. `undefined` = not sent (create: company default;
 * edit: keep the draft's own). A blank treatment counts as "not sent".
 */
export const QuotationVatSchema = z.object({
  vatTreatment: z.preprocess(
    v => (isBlank(v) ? undefined : (typeof v === 'string' ? normaliseVatTreatment(v) : v)),
    z.enum(QUOTATION_VAT_TREATMENTS, { errorMap: () => ({ message: 'Invalid VAT treatment' }) }).optional(),
  ),
  vatRate: z.preprocess(
    v => (isBlank(v) ? undefined : v),
    z.coerce.number({ invalid_type_error: 'VAT rate must be a number' })
      .min(0, 'VAT rate must be between 0 and 100')
      .max(100, 'VAT rate must be between 0 and 100')
      .optional(),
  ),
  serviceCode: z.preprocess(
    v => (v === null ? null : typeof v === 'string' ? (v.trim() || null) : v),
    z.string().max(20, 'Service code is too long').nullable().optional(),
  ),
})

/**
 * Resolve the VAT treatment, default line rate and service code for a create
 * (no `existing`) or an edit of a draft (`existing` = the stored quotation).
 *
 * @returns {{ error: string } | { treatment, defaultVatRate, serviceCode }}
 */
export function resolveQuotationVat({ input = {}, vat = null, client = null, existing = null }) {
  let treatment, defaultVatRate, serviceCode

  if (!existing) {
    const defaults = input.vatTreatment === undefined ? vatDefaultsFor(vat, client) : null
    treatment      = defaults ? defaults.vatTreatment : input.vatTreatment
    defaultVatRate = input.vatRate !== undefined ? input.vatRate : (defaults ? defaults.vatRate : defaultRateFor(treatment, vat))
    serviceCode    = input.serviceCode !== undefined ? input.serviceCode : (defaults ? defaults.serviceCode : null)
  } else {
    const stored = existing.vatTreatment || 'NONE'
    treatment = input.vatTreatment === undefined ? stored : input.vatTreatment
    // Lines without their own VAT % take: body vatRate → the draft's single rate
    // (same treatment only) → the treatment's default.
    const keptRate = treatment === stored ? uniformVatRate(existing.items) : null
    defaultVatRate = input.vatRate !== undefined ? input.vatRate : (keptRate ?? defaultRateFor(treatment, vat))
    serviceCode    = input.serviceCode !== undefined ? input.serviceCode : (existing.serviceCode ?? null)
  }

  if (treatment !== 'NONE' && vat && vat.registrationType !== 'REGISTERED') {
    return {
      error: 'The company is not VAT registered (Tax & VAT → Tax Settings), so quotations cannot carry VAT. Choose "No VAT".',
    }
  }

  return {
    treatment,
    defaultVatRate: treatment === 'NONE' ? 0 : defaultVatRate,
    serviceCode:    treatment === 'NONE' ? null : (serviceCode || null),
  }
}

// ── Request body ─────────────────────────────────────────────────────────────

// Optional free text: null stays null, numbers are stringified, length capped.
const optText = (max, label) => z.preprocess(
  v => (v === undefined || v === null ? v : typeof v === 'string' ? v : String(v)),
  z.string().max(max, `${label} is too long (max ${max} characters)`).nullable().optional(),
)

// Dates arrive as 'YYYY-MM-DD' strings from the forms; blank = not set.
const optDate = (label) => z.preprocess(
  v => (isBlank(v) ? null : v),
  z.union([z.string(), z.date()]).nullable().optional()
    .refine(v => v == null || !Number.isNaN(new Date(v).getTime()), { message: `${label} is not a valid date` }),
)

export const MAX_QUOTATION_ITEMS = 200

/**
 * Fields shared by create and edit. Line items, MFS charge and discount are
 * validated by computeQuotation (lib/quotation) so the legacy rules and
 * messages apply unchanged; here they only need the right container type.
 */
export const QuotationBodySchema = z.object({
  recipientName:    optText(200,  'Recipient name'),
  recipientCompany: optText(200,  'Recipient company'),
  recipientEmail:   optText(200,  'Recipient email'),
  recipientPhone:   optText(50,   'Recipient phone'),
  recipientAddress: optText(500,  'Recipient address'),
  items:            z.array(z.any()).max(MAX_QUOTATION_ITEMS, `A quotation can have at most ${MAX_QUOTATION_ITEMS} items`).optional(),
  issueDate:        optDate('Issue date'),
  validUntil:       optDate('Valid until'),
  taxRate:          z.any().optional(),
  discount:         z.any().optional(),
  notes:            optText(5000, 'Notes'),
  terms:            optText(5000, 'Terms'),
  currency:         z.preprocess(
    v => (isBlank(v) ? undefined : String(v).trim().toUpperCase()),
    z.string().regex(/^[A-Z]{3}$/, 'Invalid currency').optional(),
  ),
  itemPriceOnly:    z.any().optional(),
}).merge(QuotationVatSchema)

/** 422 body for a failed zod parse (house shape; the pages show the first field message). */
export function validationBody(error) {
  return { error: 'Validation failed', details: error.flatten() }
}

/**
 * 'YYYY-MM-DD' (or any Date-parsable string) → Date. Returns undefined for
 * blank input and null for an unparsable value.
 */
export function parseDateInput(v) {
  if (isBlank(v)) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
