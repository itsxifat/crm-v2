/**
 * Derive the client IP from proxy headers without trusting client-supplied
 * X-Forwarded-For entries.
 *
 * A reverse proxy that appends ($proxy_add_x_forwarded_for) leaves whatever the
 * client sent at the FRONT of the list and adds the real peer address at the
 * END. So the trustworthy entry is the N-th from the right, where N is the
 * number of trusted proxies in front of the app (TRUSTED_PROXY_HOPS, default 1).
 * Falls back to X-Real-IP (set by our own proxy), then `fallback`.
 *
 * Edge-runtime safe (no Node APIs) — used by middleware too.
 *
 * @param {(name: string) => string|null|undefined} getHeader
 * @param {string|null} [fallback]
 * @returns {string|null}
 */
export function clientIpFromHeaders(getHeader, fallback = null) {
  const hops = Math.max(1, parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 1)
  const xff  = getHeader('x-forwarded-for')
  if (xff) {
    const parts = String(xff).split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[Math.max(0, parts.length - hops)]
  }
  const real = getHeader('x-real-ip')
  if (real) return String(real).trim()
  return fallback
}
