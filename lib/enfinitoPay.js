/**
 * lib/enfinitoPay.js — SERVER-ONLY client of Enfinito Pay (pay.enfinito.com/api/v1).
 *
 * The CRM never talks to the payment gateway: it creates a checkout here, sends
 * the customer to its `url`, and learns the result from the signed webhook or
 * by retrieving the checkout server to server. The browser coming back to the
 * CRM is never proof of payment.
 */
import { enfinitoPayApiBase, getPaySettings, keyMode } from '@/lib/integrations/settings'

export class EnfinitoPayError extends Error {
  constructor(message, { status = 502, code = null, details = null } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function secretKey(key) {
  if (key) return key
  const s = await getPaySettings()
  if (!s.enabled || !keyMode(s.secretKey)) {
    throw new EnfinitoPayError('Online payment is not set up yet', { status: 503, code: 'payments_off' })
  }
  return s.secretKey
}

async function call(method, path, { body, idempotencyKey, key } = {}) {
  const headers = {
    Authorization: `Bearer ${await secretKey(key)}`,
    Accept: 'application/json',
    'User-Agent': 'enfinito-crm/1',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let res
  try {
    res = await fetch(`${enfinitoPayApiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
  } catch (err) {
    throw new EnfinitoPayError(`Enfinito Pay did not answer (${err?.message || err})`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) {
    const message = data?.error?.message || `HTTP ${res.status}`
    console.warn(`[enfinito-pay] ${method} ${path.replace(/cs_[A-Za-z0-9_]+/, 'cs_…')}: ${res.status} ${data?.error?.code ?? ''} ${message}`)
    throw new EnfinitoPayError(`Enfinito Pay: ${message}`, {
      status: res.status,
      code: data?.error?.code ?? null,
      details: data?.error?.details ?? null,
    })
  }
  return data
}

/**
 * Opens a checkout. Repeating the request with the same idempotency key returns
 * the same checkout, so a retry never opens a second one.
 * @param {{ reference: string, items: {name: string, amount: number, quantity?: number}[], success_url: string,
 *   cancel_url: string, description?: string, customer?: object, metadata?: Record<string,string> }} body
 */
export function createCheckout(body, idempotencyKey, opts = {}) {
  return call('POST', '/checkout/sessions', { body, idempotencyKey, key: opts.key })
}

export function retrieveCheckout(id, opts = {}) {
  return call('GET', `/checkout/sessions/${encodeURIComponent(id)}`, { key: opts.key })
}

/** Cancels an unpaid checkout (409 once it is paid). */
export function cancelCheckout(id, opts = {}) {
  return call('POST', `/checkout/sessions/${encodeURIComponent(id)}/cancel`, { body: {}, key: opts.key })
}

/**
 * Checks a secret key without touching any payment: asking for a checkout that
 * does not exist answers 404 to a valid key and 401 to a wrong or revoked one.
 */
export async function checkKey(key) {
  if (!keyMode(key)) return { ok: false, message: 'Use a secret key that starts with sk_test_ or sk_live_' }
  try {
    await call('GET', '/checkout/sessions/cs_crm_key_check', { key })
    return { ok: true, message: 'The key works' }
  } catch (err) {
    if (err instanceof EnfinitoPayError && err.status === 404) return { ok: true, message: 'The key works' }
    if (err instanceof EnfinitoPayError && err.status === 401) return { ok: false, message: 'Enfinito Pay refused this key (wrong or revoked)' }
    if (err instanceof EnfinitoPayError && err.status === 403) return { ok: false, message: 'This product is paused in the Enfinito Pay admin' }
    return { ok: false, message: err?.message || 'Could not reach Enfinito Pay' }
  }
}

/** 01XXXXXXXXX, or undefined: Enfinito Pay only takes Bangladeshi mobile numbers. */
export function bdMobile(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '').replace(/^880/, '0').replace(/^(?=1[3-9]\d{8}$)/, '0')
  return /^01[3-9]\d{8}$/.test(digits) ? digits : undefined
}
