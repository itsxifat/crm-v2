/**
 * lib/encryption.js
 *
 * Multi-layer database field encryption engine.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Layer 3 — Key protection                                           │
 * │    Master key + HMAC key stored only in environment variables,      │
 * │    never written to the database.                                   │
 * │                                                                     │
 * │  Layer 2 — HKDF key derivation (per collection + field)            │
 * │    Each (collection, field) pair gets its own unique 256-bit key    │
 * │    derived from the master key via HKDF-SHA256.                    │
 * │    Compromise of one field key reveals nothing about others.        │
 * │                                                                     │
 * │  Layer 1 — AES-256-GCM field encryption                            │
 * │    Random 96-bit IV per write, 128-bit auth tag provides           │
 * │    authenticated encryption (confidentiality + integrity).          │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Wire format stored in MongoDB (plain string):
 *   enc:v1:{base64url(iv)}:{base64url(authTag)}:{base64url(ciphertext)}
 *
 * Required environment variables:
 *   ENCRYPTION_MASTER_KEY   64-char hex string (32 bytes)
 *   ENCRYPTION_HMAC_KEY     64-char hex string (32 bytes)
 *
 * Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

// ── Constants ──────────────────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES  = 12   // 96-bit IV — optimal for GCM, recommended by NIST
const TAG_BYTES = 16   // 128-bit authentication tag
const KEY_BYTES = 32   // 256-bit derived keys
const PREFIX    = 'enc:v1:'

// ── Master key accessors (lazy-initialised, memoised) ─────────────────────────
let _masterKey = null
let _hmacKey   = null

function getMasterKey() {
  if (_masterKey) return _masterKey
  const hex = process.env.ENCRYPTION_MASTER_KEY
  if (!hex || hex.length < 64) {
    throw new Error(
      '[encryption] ENCRYPTION_MASTER_KEY must be a 64-hex-char (32-byte) secret.\n' +
      "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  _masterKey = Buffer.from(hex.slice(0, 64), 'hex')
  return _masterKey
}

function getHmacKey() {
  if (_hmacKey) return _hmacKey
  const hex = process.env.ENCRYPTION_HMAC_KEY
  if (!hex || hex.length < 64) {
    throw new Error(
      '[encryption] ENCRYPTION_HMAC_KEY must be a 64-hex-char (32-byte) secret.\n' +
      "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  _hmacKey = Buffer.from(hex.slice(0, 64), 'hex')
  return _hmacKey
}

// ── Layer 2: HKDF-SHA256 key derivation ──────────────────────────────────────
// Each (collection, field) combination gets a unique 256-bit key.
// info = "collection\x00field" — null-byte separator prevents collisions.
const _keyCache = new Map()

export function deriveFieldKey(collection, field) {
  const id = `${collection}\x00${field}`
  if (_keyCache.has(id)) return _keyCache.get(id)

  const info = Buffer.from(id, 'utf8')
  const raw  = hkdfSync('sha256', getMasterKey(), Buffer.alloc(0), info, KEY_BYTES)
  const key  = Buffer.from(raw)

  _keyCache.set(id, key)
  return key
}

// ── Layer 1: AES-256-GCM encrypt ──────────────────────────────────────────────
/**
 * Encrypt `value` for storage at `collection.field`.
 * Non-string values (Number, Date, Array, Object) are JSON-serialised first.
 * Returns the encrypted wire-format string, or the original value if null/undefined.
 */
export function encrypt(value, collection, field) {
  if (value === null || value === undefined) return value

  // Serialise non-strings to JSON so we can encrypt them as bytes
  const plain = typeof value === 'string' ? value : JSON.stringify(value)

  // Never double-encrypt
  if (plain.startsWith(PREFIX)) return plain

  const key    = deriveFieldKey(collection, field)
  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  const body   = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()

  // base64url (no padding) is URL-safe and avoids shell-escaping issues
  return PREFIX +
    iv.toString('base64url')   + ':' +
    tag.toString('base64url')  + ':' +
    body.toString('base64url')
}

// ── Layer 1: AES-256-GCM decrypt ──────────────────────────────────────────────
/**
 * Decrypt a value previously encrypted with `encrypt()`.
 * `originalType` controls post-decryption deserialisation:
 *   'string'  (default) — return the raw plaintext string
 *   'number'            — JSON.parse → Number
 *   'date'              — new Date(plaintext)
 *   'array'             — JSON.parse → Array
 *   'object'            — JSON.parse → plain object
 *
 * Passes through plaintext values that were never encrypted (migrating
 * existing unencrypted documents works transparently).
 */
export function decrypt(value, collection, field, originalType = 'string') {
  if (value === null || value === undefined) return value
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value

  const rest  = value.slice(PREFIX.length)
  const parts = rest.split(':')
  if (parts.length !== 3) return value  // malformed — pass through safely

  try {
    const key    = deriveFieldKey(collection, field)
    const iv     = Buffer.from(parts[0], 'base64url')
    const tag    = Buffer.from(parts[1], 'base64url')
    const body   = Buffer.from(parts[2], 'base64url')

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')

    // Deserialise to the original type
    switch (originalType) {
      case 'number': {
        const n = JSON.parse(plain)
        return typeof n === 'number' ? n : plain
      }
      case 'date': {
        const d = new Date(plain)
        return isNaN(d.getTime()) ? plain : d
      }
      case 'array':
      case 'object': {
        try { return JSON.parse(plain) } catch { return plain }
      }
      default:
        return plain
    }
  } catch (err) {
    // Decrypt failure (wrong key, tampered ciphertext) — log, never crash
    console.error(`[encryption] decrypt failed for ${collection}.${field}:`, err.message)
    return value
  }
}

// ── Blind index for equality-searchable encrypted fields ──────────────────────
/**
 * Produce a deterministic HMAC-SHA256 token for `value` that can be stored
 * as a separate indexed field and used in equality queries (findOne, $match).
 *
 * The HMAC key is separate from the encryption master key — compromise of one
 * does not affect the other.
 *
 * context = "collection:field" namespaces the index so the same plaintext
 * value in two different fields produces different tokens.
 */
export function blindIndex(value, collection, field) {
  if (value === null || value === undefined) return null
  const normalized = String(value).toLowerCase().trim()
  return createHmac('sha256', getHmacKey())
    .update(`${collection}:${field}:${normalized}`)
    .digest('base64url')
}

// ── Utility ───────────────────────────────────────────────────────────────────
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX)
}
