/**
 * Webhook signatures. Enfinito Pay (Enfinito-Signature) and encloud
 * (Encloud-Signature) sign the same way:
 *
 *   t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" keyed with the whsec_ secret>
 *
 * Always checked against the raw body exactly as received, in constant time, and
 * refused when the timestamp is more than five minutes away (no replays).
 */
import crypto from 'node:crypto'

const TOLERANCE_SEC = 300

export function signatureHeader(secret, body, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex')
  return `t=${t},v1=${v1}`
}

/**
 * @param {Buffer|string} rawBody
 * @param {string|null} header
 * @param {string} secret
 */
export function verifySignature(rawBody, header, secret, nowMs = Date.now()) {
  if (!header || !secret) return false
  const parts = new Map(
    String(header).split(',').map((p) => {
      const i = p.indexOf('=')
      return i < 0 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const t = parts.get('t') ?? ''
  const v1 = parts.get('v1') ?? ''
  if (!/^\d+$/.test(t) || !/^[0-9a-f]{64}$/i.test(v1)) return false
  if (Math.abs(nowMs / 1000 - Number(t)) > TOLERANCE_SEC) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest()
  return crypto.timingSafeEqual(expected, Buffer.from(v1, 'hex'))
}
