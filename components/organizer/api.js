// Small fetch helpers shared by the organizer UI.

/** Build a query string, skipping empty values; arrays are comma-joined. Returns '' or '?a=b…'. */
export function qs(obj = {}) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','))
    } else {
      p.set(k, String(v))
    }
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

/**
 * fetch → parsed JSON on 2xx, throws Error(message) otherwise.
 *   await orgFetch('/api/organizer/todos', { query: { status: ['OPEN'] } })
 *   await orgFetch('/api/organizer/todos', { method: 'POST', body: { title } })
 */
export async function orgFetch(url, { method = 'GET', body, query, signal } = {}) {
  const res = await fetch(url + (query ? qs(query) : ''), {
    method,
    signal,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* empty body */ }
  // Aborted while the body was read: surface it as an abort, never as an empty success.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!res.ok) {
    const details = json?.details?.fieldErrors
    const first = details ? Object.values(details).flat()[0] : null
    throw new Error(first || json?.error || `Request failed (${res.status})`)
  }
  return json
}
