/**
 * lib/telephony/envo.js — SERVER-ONLY client of Envo's public API (envo/server/src/routes/v1.ts
 * and embed.ts), with the API key from Configuration → Calling. The key never leaves this
 * server: browsers get SIP credentials for their own extension only.
 *
 *   GET  /api/v1/ping              which SIP server the key belongs to, its scopes
 *   GET  /api/v1/extensions        extensions with live presence
 *   POST /api/v1/webphone/token    short-lived token for one extension ...
 *   POST /api/embed/session        ... exchanged for its web phone's SIP credentials
 *   POST /api/v1/calls             click-to-call: rings the extension, then dials the number
 *   GET  /api/v1/calls             call history (search matches either party)
 */
import { getPhoneSettings, phoneReady } from '@/lib/integrations/settings'

export class EnvoError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'EnvoError'
    this.status = status
  }
}

const TIMEOUT_MS = 8000

/** Envo's API keys: envo_live_ + 32 base64url characters (envo/server/src/lib/apikey.ts). */
export const API_KEY_RE = /^envo_live_[A-Za-z0-9_-]{20,100}$/

function explain(status, message) {
  if (status === 401) return 'Envo refused the API key (wrong or revoked)'
  if (status === 402) return 'Envo says this account is not active'
  if (status === 403) return message || 'Envo refused: the API key is missing a permission'
  if (status === 429) return 'Envo is rate limiting this API key; try again in a minute'
  return message || `Envo answered ${status}`
}

async function request(settings, path, { method = 'GET', body, auth = true } = {}) {
  const base = String(settings.baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new EnvoError('Envo’s address is not set')
  let res
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Enfinito-CRM/1',
        ...(auth ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'error',
    })
  } catch (err) {
    throw new EnvoError(err?.name === 'TimeoutError' ? 'Envo did not answer in time' : `Could not reach Envo at ${base}`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new EnvoError(explain(res.status, data?.error), res.status)
  return data
}

/** The saved settings when calling is on, else an EnvoError saying why not. */
export async function readySettings() {
  const s = await getPhoneSettings()
  if (!phoneReady(s)) throw new EnvoError('Calling through Envo is not set up (Configuration → Calling)', 503)
  return s
}

export const ping = (settings) => request(settings, '/api/v1/ping')

export const listExtensions = (settings) => request(settings, '/api/v1/extensions')

/** SIP credentials of one extension's web phone (token minted and exchanged here, server side). */
export async function webPhoneSession(settings, extension) {
  const { token } = await request(settings, '/api/v1/webphone/token', {
    method: 'POST', body: { extension, ttlSeconds: 60 },
  })
  const s = await request(settings, '/api/embed/session', { method: 'POST', body: { token }, auth: false })
  if (!s?.wsUrl || !s?.username || !s?.password || !s?.domain) throw new EnvoError('Envo returned incomplete web phone details')
  return s
}

// The same person's tabs hand the phone to one another, and each start asks for its
// credentials: keep them briefly instead of spending Envo's rate limit (120/min per key)
// on tokens. Envo's web phone password does not change, so this is only a cache.
const SESSION_TTL_MS = 10 * 60_000
const sessions = globalThis.__envoPhoneSessions ?? (globalThis.__envoPhoneSessions = new Map())

export async function cachedWebPhoneSession(settings, userId, extension) {
  const key = `${userId}|${extension}|${settings.baseUrl}`
  const hit = sessions.get(key)
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.value
  const value = await webPhoneSession(settings, extension)
  sessions.set(key, { value, at: Date.now() })
  if (sessions.size > 500) sessions.delete(sessions.keys().next().value)
  return value
}

/** After the calling settings change (another key, address or extension). */
export function forgetWebPhoneSessions() {
  sessions.clear()
}

/** Rings the extension's phones (desk phone, apps, web phone), then dials `to` once answered. */
export const originate = (settings, { extension, to }) =>
  request(settings, '/api/v1/calls', { method: 'POST', body: { from: extension, to } })

/** Calls in which either party matches `search` (Envo matches it inside the numbers). */
export function callHistory(settings, { search, limit = 6, days = 365 }) {
  const q = new URLSearchParams({
    search: String(search).slice(0, 40),
    limit: String(limit),
    from: new Date(Date.now() - days * 86400_000).toISOString(),
  })
  return request(settings, `/api/v1/calls?${q}`)
}
