/**
 * lib/encloud/client.js — SERVER-ONLY client of encloud's CRM API
 * (<encloud>/api/v1, contract: encloud docs/crm-api.md).
 *
 * Ids in paths are the CRM's own ids (Mongo _id strings). Money is BDT.
 * Errors come back as { error, code }; they are thrown as EncloudError with the
 * HTTP status, so callers can tell "not there yet" (404) and "already closed"
 * (409 due_closed) from real failures.
 */
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'

export class EncloudError extends Error {
  constructor(message, { status = 502, code = null } = {}) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function encloudBase(settings) {
  return String(settings?.baseUrl || '').trim().replace(/\/+$/, '')
}

async function call(method, path, body, { settings } = {}) {
  const s = settings ?? await getEncloudSettings()
  if (!encloudReady(s)) throw new EncloudError('encloud is not connected', { status: 503, code: 'encloud_off' })

  let res
  try {
    res = await fetch(`${encloudBase(s)}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${s.apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'enfinito-crm/1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
      redirect: 'manual',
    })
  } catch (err) {
    throw new EncloudError(`encloud did not answer (${err?.cause?.code || err?.message || err})`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data?.error || `HTTP ${res.status}`
    throw new EncloudError(`encloud: ${message}`, { status: res.status, code: data?.code ?? null })
  }
  return data
}

const id = (v) => encodeURIComponent(String(v))

export const encloud = {
  ping:          (opts)                => call('GET', '/ping', undefined, opts),

  putClient:     (crmId, body, opts)   => call('PUT', `/clients/${id(crmId)}`, body, opts),
  getClient:     (crmId, opts)         => call('GET', `/clients/${id(crmId)}`, undefined, opts),

  putProject:    (crmId, body, opts)   => call('PUT', `/projects/${id(crmId)}`, body, opts),
  getProject:    (crmId, opts)         => call('GET', `/projects/${id(crmId)}`, undefined, opts),

  shareProject:  (crmId, body, opts)   => call('POST', `/projects/${id(crmId)}/shares`, body, opts),
  shareClient:   (crmId, body, opts)   => call('POST', `/clients/${id(crmId)}/shares`, body, opts),
  getShare:      (shareId, opts)       => call('GET', `/shares/${id(shareId)}`, undefined, opts),
  revokeShare:   (shareId, opts)       => call('DELETE', `/shares/${id(shareId)}`, undefined, opts),
  addRecipients: (shareId, body, opts) => call('POST', `/shares/${id(shareId)}/recipients`, body, opts),

  putDue:        (crmId, body, opts)   => call('PUT', `/dues/${id(crmId)}`, body, opts),
  getDue:        (crmId, opts)         => call('GET', `/dues/${id(crmId)}`, undefined, opts),
  markDuePaid:   (crmId, paidVia, opts) => call('POST', `/dues/${id(crmId)}/mark-paid`, { paid_via: paidVia }, opts),
  cancelDue:     (crmId, opts)         => call('POST', `/dues/${id(crmId)}/cancel`, {}, opts),
  reopenDue:     (crmId, opts)         => call('POST', `/dues/${id(crmId)}/reopen`, {}, opts),
}
