/**
 * Tiny in-process fixed-window limiter for public endpoints (payment links).
 * Per instance, like the middleware's — enough for the single-server / PM2
 * deployments this app targets.
 */
const store = globalThis.__rateLimitStore ?? (globalThis.__rateLimitStore = new Map())
let lastSweep = 0

/** @returns {{ ok: boolean, retryAfter: number }} */
export function hit(key, limit, windowMs) {
  const now = Date.now()
  if (now - lastSweep > 60_000) {
    lastSweep = now
    for (const [k, v] of store) if (now - v.since > v.windowMs) store.delete(k)
  }
  let entry = store.get(key)
  if (!entry || now - entry.since > windowMs) {
    entry = { count: 0, since: now, windowMs }
    store.set(key, entry)
  }
  entry.count += 1
  return { ok: entry.count <= limit, retryAfter: Math.ceil((entry.since + windowMs - now) / 1000) }
}
