/**
 * lib/invoiceTotals.js — invoice line / total calculation + validation.
 *
 * PURE module: it is imported by the invoice form in the browser as well as by
 * the invoice and quotation APIs, so it must never import server code (and it
 * avoids the '@/' alias so plain Node scripts can load it too).
 *
 * Shared by invoice create (POST /api/invoices), edit (PUT /api/invoices/:id),
 * the quotation calculator (lib/quotation.js) and the live totals in the form,
 * so every surface applies exactly the same rules.
 *
 * Money model
 * ───────────
 *   amount        = quantity × rate                        (per line)
 *   subtotal      = Σ amount
 *   discount      = flat amount, allocated pro-rata to the lines by amount
 *   taxableValue  = amount − discountShare                  (per line, VAT base)
 *   sdAmount      = taxableValue × sdRate%                  (supplementary duty)
 *   vatAmount     = (taxableValue + sdAmount) × vatRate%    (VAT is charged on the SD-inclusive value)
 *   lineTotal     = taxableValue + sdAmount + vatAmount
 *   taxAmount     = subtotal × taxRate%  — the "MFS Charge" (mobile-payment
 *                   surcharge). It is NOT VAT and its formula is unchanged.
 *   total         = subtotal − discount + Σ sdAmount + Σ vatAmount + taxAmount
 *
 * Backward compatibility
 * ──────────────────────
 * Callers that do not pass `vatTreatment` (or pass 'NONE') get exactly the
 * numbers the pre-VAT implementation produced for every field it returned
 * (items[].description/quantity/rate/amount, subtotal, taxRate, taxAmount,
 * discount, total) — same formulas, same rounding, same validation rules — plus
 * the new VAT fields, which are all zero for a non-VAT invoice.
 *   • NONE: 0 <= discount <= subtotal + MFS charge (legacy rule)
 *   • any VAT treatment: 0 <= discount <= subtotal (the VAT base can never go
 *     negative, and the discount reduces the VAT base, as the VAT Act requires)
 *   • STANDARD lines are exactly 15%; REDUCED lines are above 0% and below 15%
 *     (the treatment picks the Mushak-9.1 note, so rates may not cross it)
 */

export const INVOICE_VAT_TREATMENTS = ['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE']

/** Treatments that never carry a VAT rate on the line. */
const ZERO_RATE_TREATMENTS = ['ZERO_RATED', 'EXEMPT', 'NONE']
/** Treatments that never carry supplementary duty (not a VAT invoice / export). */
const NO_SD_TREATMENTS = ['ZERO_RATED', 'NONE']

/** Highest supplementary-duty rate accepted (Second Schedule goes up to 500%). */
export const SD_MAX_RATE = 500

// Rounding of the fields that existed before VAT support. Kept exactly as it was
// so re-saving an old draft (or any non-VAT invoice) can never shift a number.
const legacyRound = n => Math.round(n * 100) / 100
// House money rule for everything new: 2 decimals, half-up.
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// '' / null / undefined → NaN (so "required" numbers fail validation)
const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v))
// '' / null / undefined → undefined (so "optional" numbers fall back to a default)
const optNum = v => (v === '' || v === null || v === undefined ? undefined : Number(v))

function cleanStr(v, max = 120) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

class InvoiceCalcError extends Error {}

/**
 * Split `totalCents` across `weights` (integer cents) pro-rata, in whole cents,
 * so the shares always add up exactly and no share exceeds its own weight.
 * Leftover cents go to the largest fractional parts; ties go to the later line
 * (so the last line absorbs the rounding remainder).
 */
function allocateCents(totalCents, weights) {
  const W = weights.reduce((s, w) => s + w, 0)
  if (W <= 0 || totalCents <= 0) return weights.map(() => 0)
  const target = Math.min(totalCents, W)
  const raw    = weights.map(w => (target * w) / W)
  const shares = raw.map((r, i) => Math.min(weights[i], Math.max(0, Math.floor(r))))
  let left = target - shares.reduce((s, v) => s + v, 0)

  const order = raw
    .map((r, i) => ({ i, f: r - Math.floor(r) }))
    .sort((a, b) => (b.f - a.f) || (b.i - a.i))
  for (const { i } of order) {
    if (left <= 0) break
    if (shares[i] + 1 > weights[i]) continue
    shares[i] += 1
    left -= 1
  }
  // Floating-point safety net (practically unreachable): fill from the end.
  for (let i = shares.length - 1; i >= 0 && left > 0; i--) {
    const room = weights[i] - shares[i]
    if (room <= 0) continue
    const add = Math.min(room, left)
    shares[i] += add
    left -= add
  }
  return shares
}

/**
 * Core calculation. In strict mode the first problem aborts with an error; in
 * lenient mode every problem is recorded in `issues` and a safe value is used
 * instead, so a half-filled form can still show live totals.
 */
function calculate(params, strict) {
  const {
    items,
    taxRate,
    discount,
    vatTreatment: rawTreatment,
    defaultVatRate: rawDefaultRate,
  } = params ?? {}
  const issues = []
  const problem = (msg) => {
    if (strict) throw new InvoiceCalcError(msg)
    issues.push(msg)
  }

  // ── VAT treatment & default rate ─────────────────────────────────────────
  let vatTreatment = rawTreatment === undefined || rawTreatment === null || rawTreatment === ''
    ? 'NONE'
    : String(rawTreatment).toUpperCase()
  if (!INVOICE_VAT_TREATMENTS.includes(vatTreatment)) {
    problem('Invalid VAT treatment')
    vatTreatment = 'NONE'
  }
  const isVat = vatTreatment !== 'NONE'
  const lineRatesApply = !ZERO_RATE_TREATMENTS.includes(vatTreatment)
  const sdApplies      = !NO_SD_TREATMENTS.includes(vatTreatment)

  let defaultVatRate = optNum(rawDefaultRate)
  if (defaultVatRate === undefined) defaultVatRate = 0
  if (lineRatesApply && (!Number.isFinite(defaultVatRate) || defaultVatRate < 0 || defaultVatRate > 100)) {
    problem('VAT rate must be between 0 and 100')
    defaultVatRate = Number.isFinite(defaultVatRate) ? Math.min(100, Math.max(0, defaultVatRate)) : 0
  }

  // ── Lines ────────────────────────────────────────────────────────────────
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) problem('At least one item required')

  const processed = []
  for (const [i, item] of list.entries()) {
    let quantity = num(item?.quantity)
    let rate     = num(item?.rate ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      problem(`Item ${i + 1}: quantity must be greater than 0`)
      quantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0
    }
    if (!Number.isFinite(rate) || rate < 0) {
      problem(`Item ${i + 1}: rate must be 0 or more`)
      rate = 0
    }

    let vatRate = 0
    if (lineRatesApply) {
      const own = optNum(item?.vatRate)
      vatRate = own === undefined ? defaultVatRate : own
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        problem(`Item ${i + 1}: VAT rate must be between 0 and 100`)
        vatRate = Number.isFinite(vatRate) ? Math.min(100, Math.max(0, vatRate)) : defaultVatRate
      } else if (vatTreatment === 'STANDARD' && vatRate !== 15) {
        // The treatment decides the Mushak-9.1 note (STANDARD → 4, REDUCED → 7),
        // so every line's rate must belong to it: one invoice, one note.
        problem(`Item ${i + 1}: standard-rated supplies are VAT 15% — use treatment REDUCED (or EXEMPT for 0%) for ${vatRate}%`)
      } else if (vatTreatment === 'REDUCED' && !(vatRate > 0 && vatRate < 15)) {
        problem(`Item ${i + 1}: reduced-rate VAT must be above 0% and below 15% — use STANDARD for 15% or EXEMPT for 0%`)
      }
    }

    let sdRate = 0
    if (sdApplies) {
      const own = optNum(item?.sdRate)
      sdRate = own === undefined ? 0 : own
      if (!Number.isFinite(sdRate) || sdRate < 0 || sdRate > SD_MAX_RATE) {
        problem(`Item ${i + 1}: SD rate must be between 0 and ${SD_MAX_RATE}`)
        sdRate = Number.isFinite(sdRate) ? Math.min(SD_MAX_RATE, Math.max(0, sdRate)) : 0
      }
    }

    processed.push({
      description: item?.description,
      quantity,
      rate,
      amount: legacyRound(quantity * rate),
      unit:        cleanStr(item?.unit, 20),
      serviceCode: cleanStr(item?.serviceCode, 20),
      vatRate,
      sdRate,
    })
  }

  // ── MFS charge (legacy taxRate / taxAmount) & discount ───────────────────
  let tax  = taxRate === '' || taxRate == null ? 0 : Number(taxRate)
  let disc = discount === '' || discount == null ? 0 : Number(discount)
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
    problem('MFS charge must be between 0 and 100%')
    tax = Number.isFinite(tax) ? Math.min(100, Math.max(0, tax)) : 0
  }

  const subtotal  = legacyRound(processed.reduce((s, i) => s + i.amount, 0))
  const taxAmount = legacyRound(subtotal * (tax / 100))

  const maxDiscount = isVat ? subtotal : subtotal + taxAmount
  if (!Number.isFinite(disc) || disc < 0 || disc > maxDiscount + 0.001) {
    problem(isVat
      ? 'Discount cannot be more than the subtotal (before VAT)'
      : 'Discount must be between 0 and the invoice subtotal')
    disc = Number.isFinite(disc) ? Math.min(maxDiscount, Math.max(0, disc)) : 0
  }

  // ── Discount allocation → taxable value → SD → VAT per line ──────────────
  const amountCents = processed.map(p => Math.max(0, Math.round(p.amount * 100)))
  const shares      = allocateCents(Math.round(disc * 100), amountCents)

  let taxableSum = 0, sdSum = 0, vatSum = 0
  const outItems = processed.map((p, i) => {
    const discountShare = shares[i] / 100
    const taxableValue  = round2(p.amount - discountShare)
    const sdAmount      = p.sdRate  ? round2(taxableValue * p.sdRate / 100) : 0
    const vatAmount     = p.vatRate ? round2((taxableValue + sdAmount) * p.vatRate / 100) : 0
    const lineTotal     = round2(taxableValue + sdAmount + vatAmount)
    taxableSum += taxableValue
    sdSum      += sdAmount
    vatSum     += vatAmount
    return { ...p, discountShare, taxableValue, sdAmount, vatAmount, lineTotal }
  })

  const taxableValue = round2(taxableSum)
  const sdAmount     = round2(sdSum)
  const vatAmount    = round2(vatSum)

  // Same expression as the legacy implementation; SD/VAT are 0 for NONE.
  const base  = subtotal + taxAmount - disc
  const total = isVat ? round2(base + sdAmount + vatAmount) : legacyRound(base)

  return {
    result: {
      items: outItems,
      subtotal,
      discount: disc,
      taxableValue,
      sdAmount,
      vatAmount,
      taxRate: tax,
      taxAmount,
      total,
      vatTreatment,
    },
    issues,
  }
}

/**
 * Server-side (and pre-submit) invoice calculation + validation.
 *
 * @param {object} p
 * @param {Array}  p.items            [{ description, quantity, rate, unit?, serviceCode?, vatRate?, sdRate? }]
 * @param {number} p.taxRate          MFS charge % (0–100) — legacy field name
 * @param {number} p.discount         flat discount amount
 * @param {string} p.vatTreatment     'STANDARD'|'REDUCED'|'ZERO_RATED'|'EXEMPT'|'NONE' (default 'NONE')
 * @param {number} p.defaultVatRate   rate for lines without their own vatRate (0–100, default 0)
 * @returns {{ error: string } | {
 *   items: Array<{ description, quantity, rate, amount, unit, serviceCode, vatRate, sdRate,
 *                  discountShare, taxableValue, sdAmount, vatAmount, lineTotal }>,
 *   subtotal, discount, taxableValue, sdAmount, vatAmount, taxRate, taxAmount, total, vatTreatment }}
 */
export function computeInvoiceTotals({ items, taxRate, discount, vatTreatment = 'NONE', defaultVatRate = 0 } = {}) {
  try {
    return calculate({ items, taxRate, discount, vatTreatment, defaultVatRate }, true).result
  } catch (err) {
    if (err instanceof InvoiceCalcError) return { error: err.message }
    throw err
  }
}

/**
 * Lenient variant for live totals in forms: never fails. Invalid inputs are
 * replaced by safe values (blank quantity → 0, discount clamped, …) and every
 * problem is listed in `issues` so the form can show it.
 *
 * @returns same shape as computeInvoiceTotals plus `issues: string[]`
 */
export function previewInvoiceTotals(params = {}) {
  const { result, issues } = calculate(params, false)
  return { ...result, issues }
}

// ── Display helpers (used by the invoice print views) ──────────────────────

/** True when the invoice is a VAT invoice or carries any VAT / SD. */
export function isVatInvoice(inv) {
  if (!inv) return false
  const t = inv.vatTreatment
  return (!!t && t !== 'NONE') || (Number(inv.vatAmount) || 0) > 0 || (Number(inv.sdAmount) || 0) > 0
}

/** Taxable value (VAT base) with the legacy fallback: subtotal − discount (never below 0). */
export function taxableValueOf(inv) {
  if (!inv) return 0
  const stored = inv.taxableValue
  if (stored !== null && stored !== undefined && stored !== '' && Number.isFinite(Number(stored))) return round2(stored)
  const sub  = Number(inv.subtotal) || 0
  const disc = Math.min(Number(inv.discount) || 0, sub)
  return round2(Math.max(0, sub - disc))
}

/** The single VAT rate shared by every chargeable line, or null when lines differ / none. */
export function uniformVatRate(items) {
  const rates = new Set(
    (Array.isArray(items) ? items : [])
      .filter(i => (Number(i?.amount ?? (Number(i?.quantity) || 0) * (Number(i?.rate) || 0)) || 0) > 0)
      .map(i => Number(i?.vatRate) || 0)
  )
  return rates.size === 1 ? [...rates][0] : null
}

/** Label for the VAT totals row: "VAT (15%)", "VAT (zero-rated)", "VAT (exempt)" or "VAT". */
export function invoiceVatLabel(inv) {
  const t = inv?.vatTreatment
  if (t === 'ZERO_RATED') return 'VAT (zero-rated)'
  if (t === 'EXEMPT')     return 'VAT (exempt)'
  const r = uniformVatRate(inv?.items)
  return r === null ? 'VAT' : `VAT (${r}%)`
}
