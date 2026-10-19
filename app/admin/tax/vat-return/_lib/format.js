/**
 * Client formatting helpers for the tax pages (VAT return, registers, settings). PURE.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** '1,23,456.70' — Bangladeshi digit grouping, 2 decimals. Empty string for null. */
export function fmtAmount(v, { blankZero = false } = {}) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  if (blankZero && Math.abs(n) < 0.005) return ''
  const r = round2(Math.abs(n))
  const s = r.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < -0.0049 ? `-${s}` : s
}

export function fmtQty(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : String(v)
}

/** '15 Oct 2026' for a Date / ISO / 'YYYY-MM-DD' (Dhaka calendar day). */
export function fmtDay(value) {
  if (value === null || value === undefined || value === '') return ''
  const s = typeof value === 'string' ? value.trim() : null
  const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return ''
  const d = new Date(t + DHAKA_OFFSET_MS)
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** 'Oct 2026' for '2026-10'. */
export function fmtPeriod(p) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(p ?? ''))
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (p ?? '')
}

/** Today's Dhaka day as 'YYYY-MM-DD'. */
export function todayKey() {
  return new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/** Read a JSON response and throw a readable Error when it failed. */
export async function readJson(res) {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const field = json?.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat()[0] : null
    const err = new Error(field && json.error === 'Validation failed' ? field : (json.error || 'Request failed'))
    err.status = res.status
    err.details = json.details
    throw err
  }
  return json
}

export const RETURN_TYPE_OPTIONS = [
  { value: 'ORIGINAL',        label: 'Original (s.64)' },
  { value: 'LATE',            label: 'Late (s.65)' },
  { value: 'AMENDED',         label: 'Amended (s.66)' },
  { value: 'FULL_ADDITIONAL', label: 'Full / additional / alternative (s.67)' },
]

export const RETURN_TYPE_LABELS = Object.fromEntries(RETURN_TYPE_OPTIONS.map(o => [o.value, o.label]))

// Class strings mirroring components/ui/Input (inputClass / Label) and Button (default / outline)
// for raw elements in the tax pages. Prefer the components themselves in new code.
// No fixed height: some callers put it on a <textarea>.
export const inputCls = 'block min-h-9 w-full min-w-0 rounded-lg border border-input bg-white px-3 py-1.5 text-sm text-gray-900 shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-gray-400 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus:border-ring focus:ring-[3px] focus:ring-ring/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60'
export const labelCls = 'mb-2 block text-sm font-medium leading-none text-gray-900'
export const btnPrimary = "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg h-9 px-4 has-[>svg]:px-3 text-sm font-medium bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([class*='w-'])]:size-4"
export const btnGhost = "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg h-9 px-4 has-[>svg]:px-3 text-sm font-medium border border-input bg-white text-gray-900 shadow-xs hover:bg-accent transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([class*='w-'])]:size-4"
