import crypto from 'crypto'
import { User } from '@/models'

/**
 * Self-service password reset by emailed one-time code.
 *
 *   1. request  → a 6-digit code is emailed (no link — links are what get
 *                 spam-filtered). Same response whether or not the account exists.
 *   2. verify   → code checked with an atomically-reserved attempt budget; a
 *                 correct code is burned and swapped for a short-lived reset token.
 *   3. reset    → the token sets the new password, once.
 *
 * Codes and tokens are only ever stored hashed.
 */

export const OTP_TTL_MS          = 10 * 60 * 1000  // code lifetime
export const OTP_MAX_ATTEMPTS    = 5               // wrong guesses per code
export const RESEND_COOLDOWN_MS  = 60 * 1000       // min gap between codes per account
export const SEND_WINDOW_MS      = 60 * 60 * 1000  // rolling window for the send cap
export const MAX_SENDS_PER_WINDOW = 5              // codes per account per window
export const RESET_TOKEN_TTL_MS  = 15 * 60 * 1000  // time to choose a password after verifying

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(v) {
  return String(v ?? '').trim().toLowerCase()
}

export function isValidEmail(v) {
  return v.length <= 254 && EMAIL_RE.test(v)
}

function secret() {
  const s = process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_HMAC_KEY
  if (!s) throw new Error('NEXTAUTH_SECRET is not configured')
  return s
}

/** Cryptographically-random 6-digit code (zero-padded). */
export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Keyed hash of a code, bound to the user so a stored hash is useless elsewhere. */
export function hashCode(userId, code) {
  return crypto.createHmac('sha256', secret()).update(`pwreset:${userId}:${code}`).digest('hex')
}

export function newResetToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/** Case-insensitive exact email lookup (emails are stored lowercased, but be lenient). */
export async function findUserByEmail(email, select) {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const q = User.findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } })
  if (select) q.select(select)
  return q.lean()
}

export function dhakaStamp(d = new Date()) {
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}
