import { formatDistanceToNowStrict } from 'date-fns'

/** JSON fetch for the mail admin screens. Throws an Error carrying `status` and the parsed `body`. */
export async function mailApi(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = {}
  try { json = await res.json() } catch { json = {} }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

const isResult = (r) => r && typeof r === 'object' && typeof r.ok === 'boolean'

/** IMAP/SMTP test results attached to a failed save (422), wherever the API puts them. */
export function testDetailsOf(body) {
  const candidates = [body?.details, body?.test, body?.data, body?.result, body]
  for (const c of candidates) {
    if (c && typeof c === 'object' && (isResult(c.imap) || isResult(c.smtp))) {
      return { imap: c.imap ?? null, smtp: c.smtp ?? null }
    }
  }
  return null
}

// Server validation keys → form field keys (nested server objects surface on the host field).
const SERVER_FIELD_MAP = { imap: 'imapHost', smtp: 'smtpHost', 'imap.host': 'imapHost', 'imap.port': 'imapPort', 'smtp.host': 'smtpHost', 'smtp.port': 'smtpPort' }

/** Field errors from a zod `flatten()` style payload → { field: message } | null. */
export function fieldErrorsOf(body) {
  const fe = body?.details?.fieldErrors ?? body?.fieldErrors ?? body?.fields
  if (!fe || typeof fe !== 'object' || Array.isArray(fe)) return null
  const out = {}
  for (const [k, v] of Object.entries(fe)) {
    const msg = Array.isArray(v) ? v[0] : v
    if (msg) out[SERVER_FIELD_MAP[k] ?? k] = String(msg)
  }
  return Object.keys(out).length ? out : null
}

const SHORT_UNITS = { xSeconds: 's', xMinutes: 'm', xHours: 'h', xDays: 'd', xWeeks: 'w', xMonths: 'mo', xYears: 'y' }

// Compact date-fns locale: "2m ago", "3h ago".
const shortLocale = {
  formatDistance: (token, count, options) => {
    const v = `${count}${SHORT_UNITS[token] ?? ''}`
    if (!options?.addSuffix) return v
    return options.comparison > 0 ? `in ${v}` : `${v} ago`
  },
}

export function timeAgo(date) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  if (Math.abs(Date.now() - d.getTime()) < 10_000) return 'Just now'
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: shortLocale })
}

/** Hex colour + alpha → #rrggbbaa (falls back to zinc-500 for anything unexpected). */
export function tint(color, alpha) {
  const hex = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#71717a'
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0')
}
