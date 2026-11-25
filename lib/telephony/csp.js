/**
 * lib/telephony/csp.js — where the browser phone may open its SIP WebSocket.
 *
 * Envo gives web phones wss://<its SIP domain>/ws (call.enfinito.cloud in production,
 * DNS-only because SIP cannot pass Cloudflare). The page's Content-Security-Policy
 * (middleware.js) only lets the browser connect to the origins listed here.
 *
 * ENVO_PHONE_WS: origins, space or comma separated (default wss://call.enfinito.cloud).
 * Read by middleware.js (Edge) and the phone session route (Node): no imports.
 */
export const DEFAULT_PHONE_WS = 'wss://call.enfinito.cloud'

export function phoneWsOrigins() {
  const raw = (typeof process !== 'undefined' && process.env?.ENVO_PHONE_WS) || DEFAULT_PHONE_WS
  const out = []
  for (const item of String(raw).split(/[\s,]+/)) {
    if (!item) continue
    try {
      const u = new URL(item)
      if ((u.protocol === 'wss:' || u.protocol === 'ws:') && !out.includes(u.origin)) out.push(u.origin)
    } catch { /* not a URL: ignored */ }
  }
  return out
}

/** Is the WebSocket URL Envo returned one the page may open? */
export function phoneWsAllowed(wsUrl) {
  try { return phoneWsOrigins().includes(new URL(wsUrl).origin) } catch { return false }
}
