/**
 * Pure formatting helpers shared by the inventory dashboard, reports and
 * settings pages (client-safe: no server imports).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const moneyFmt = new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const moneyFmt0 = new Intl.NumberFormat('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const numFmt = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 4 })

/** 1234567.5 → '12,34,567.50'; negatives in brackets (accounting style). */
export function fmtMoney(value, { decimals = 2, brackets = true } = {}) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  const abs = Math.abs(n)
  const s = (decimals === 0 ? moneyFmt0 : moneyFmt).format(abs)
  if (n < 0 && abs >= 0.005) return brackets ? `(${s})` : `-${s}`
  return s
}

/** '৳ 12,34,567' style for headline figures. */
export function fmtTk(value, decimals = 0) {
  if (value === null || value === undefined || value === '') return '—'
  return `৳ ${fmtMoney(value, { decimals, brackets: false })}`
}

export function fmtNumber(value) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? numFmt.format(n) : String(value)
}

/** 'YYYY-MM-DD' (or any date) → '15 Oct 2026'. */
export function fmtDay(value) {
  if (!value) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
  if (m) return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  // Dhaka calendar day (UTC+6, no DST)
  const dk = new Date(d.getTime() + 6 * 60 * 60 * 1000)
  return `${String(dk.getUTCDate()).padStart(2, '0')} ${MONTHS[dk.getUTCMonth()]} ${dk.getUTCFullYear()}`
}

/** '2026-10' → 'Oct 2026'. */
export function fmtPeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period ?? ''))
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(period ?? '')
}

/** Current Dhaka period 'YYYY-MM'. */
export function currentPeriod() {
  const d = new Date(Date.now() + 6 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function shiftPeriod(period, n) {
  const [y, m] = String(period).split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Relative "x days ago" for timestamps. */
export function fmtAgo(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const day = 24 * 60 * 60 * 1000
  if (diff < 60 * 1000) return 'just now'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} min ago`
  if (diff < day) return `${Math.floor(diff / 3600000)} h ago`
  if (diff < 30 * day) return `${Math.floor(diff / day)} d ago`
  return fmtDay(value)
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Fetch JSON with the house error convention. */
export async function fetchJson(url, options) {
  const res = await fetch(url, options)
  let json = null
  try { json = await res.json() } catch { json = null }
  if (!res.ok) {
    const err = new Error(json?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = json?.data ?? null
    err.details = json?.details ?? null
    throw err
  }
  return json
}

/** First message from a zod `details.fieldErrors`, else the error message. */
export function errorText(err) {
  const fe = err?.details?.fieldErrors
  if (fe) {
    for (const [k, v] of Object.entries(fe)) if (Array.isArray(v) && v.length) return `${k}: ${v[0]}`
  }
  const fo = err?.details?.formErrors
  if (Array.isArray(fo) && fo.length) return fo[0]
  return err?.message || 'Something went wrong'
}
