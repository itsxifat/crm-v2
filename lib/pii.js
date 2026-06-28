/**
 * lib/pii.js — Role-based PII (personally identifiable / confidential) masking.
 *
 * Field-level encryption was removed in favour of plaintext storage, so the
 * only thing protecting confidential fields at read-time is this layer. Apply
 * it to the JSON you return from STAFF-facing routes (admin viewing other
 * people's records). Self-service routes (/api/client/*, /api/freelancer/*,
 * /api/employee/profile) should NOT mask — a user always sees their own data.
 *
 * Visibility is permission-driven via canDo(), so:
 *   • SUPER_ADMIN sees everything (holds all pii.* permissions).
 *   • Any custom role you grant e.g. `pii.contact.view` sees that category.
 *   • Everyone else gets partial masks (j•••@gmail.com, +8801•••••89).
 *
 * Usage:
 *   import { maskDoc, CLIENT_PII } from '@/lib/pii'
 *   return NextResponse.json({ data: maskDoc(session, client.toJSON(), CLIENT_PII) })
 */

import { canDo } from '@/lib/rbac'

const DOT = '•'

// ── Mask primitives ──────────────────────────────────────────────────────────

export function maskEmail(v) {
  if (v == null || typeof v !== 'string') return v
  const at = v.indexOf('@')
  if (at < 1) return maskText(v)
  const local  = v.slice(0, at)
  const domain = v.slice(at + 1)
  const dot    = domain.lastIndexOf('.')
  const tld    = dot >= 0 ? domain.slice(dot) : ''
  return `${local[0]}${DOT.repeat(Math.max(2, local.length - 1))}@${domain[0] ?? ''}${DOT.repeat(2)}${tld}`
}

export function maskPhone(v) {
  if (v == null) return v
  const s = String(v)
  const visible = s.replace(/[^\d+]/g, '')
  if (visible.replace(/\D/g, '').length < 4) return DOT.repeat(Math.max(3, s.length))
  const head = visible.slice(0, Math.min(4, visible.length - 2))
  const tail = visible.slice(-2)
  return `${head}${DOT.repeat(Math.max(3, visible.length - head.length - 2))}${tail}`
}

/** Generic short text (names, city, etc.): keep first + last char. */
export function maskText(v) {
  if (v == null) return v
  const s = String(v)
  if (s.length <= 2) return DOT.repeat(2)
  return `${s[0]}${DOT.repeat(Math.max(2, s.length - 2))}${s.slice(-1)}`
}

/** Longer free text (addresses): keep a short prefix only. */
export function maskAddress(v) {
  if (v == null) return v
  const s = String(v)
  if (s.length <= 4) return DOT.repeat(4)
  return `${s.slice(0, 3)} ${DOT.repeat(6)}`
}

/** Identity / KYC numbers: reveal last 4 only. */
export function maskIdentity(v) {
  if (v == null) return v
  const s = String(v)
  if (s.length <= 4) return DOT.repeat(4)
  return `${DOT.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`
}

/** Money / account values: fully hidden token (renders fine in UI as a string). */
export function maskMoney(v) {
  if (v == null) return v
  return DOT.repeat(6)
}

const MASKERS = {
  email:    maskEmail,
  phone:    maskPhone,
  text:     maskText,
  address:  maskAddress,
  identity: maskIdentity,
  money:    maskMoney,
}

// ── Nested-path helpers (operate on plain JSON objects) ───────────────────────

function getPath(obj, path) {
  return path.split('.').reduce((cur, key) => (cur == null ? cur : cur[key]), obj)
}

function setPath(obj, path, value) {
  const keys = path.split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') return
    cur = cur[keys[i]]
  }
  const last = keys[keys.length - 1]
  if (last in cur) cur[last] = value
}

// ── Spec definitions: permission → [ [path, type], ... ] ──────────────────────
// Paths are relative to a single record's JSON (after .toJSON() / .lean()).

export const CLIENT_PII = {
  'pii.contact.view': [
    ['userId.email', 'email'], ['userId.phone', 'phone'],
    ['companyEmail', 'email'], ['companyPhone', 'phone'], ['altPhone', 'phone'],
    ['website', 'text'],
  ],
  'pii.address.view': [
    ['address', 'address'], ['city', 'text'], ['country', 'text'], ['timezone', 'text'],
  ],
  'pii.identity.view': [
    ['vatNumber', 'identity'],
    ['kyc.documentNumber', 'identity'], ['kyc.primaryDoc', 'identity'],
  ],
}

export const LEAD_PII = {
  'pii.contact.view': [
    ['email', 'email'], ['phone', 'phone'], ['alternativePhone', 'phone'],
  ],
  'pii.address.view': [
    ['location', 'address'],
  ],
  'pii.financial.view': [
    ['value', 'money'],
  ],
}

export const EMPLOYEE_PII = {
  'pii.contact.view': [
    ['userId.email', 'email'], ['userId.phone', 'phone'],
    ['phone', 'phone'], ['secondaryPhone', 'phone'], ['homePhone', 'phone'],
    ['companyPhone', 'phone'], ['companyWebmail', 'email'],
  ],
  'pii.address.view': [
    ['address', 'address'],
  ],
  'pii.identity.view': [
    ['nidNumber', 'identity'], ['passportNumber', 'identity'],
  ],
  'pii.financial.view': [
    ['salary', 'money'],
  ],
}

export const FREELANCER_PII = {
  'pii.contact.view': [
    ['userId.email', 'email'], ['userId.phone', 'phone'],
    ['contactPerson.phone', 'phone'], ['contactPerson.email', 'email'],
    ['agencyInfo.phone', 'phone'],
  ],
  'pii.address.view': [
    ['agencyInfo.address', 'address'],
  ],
  'pii.financial.view': [
    ['hourlyRate', 'money'],
    ['paymentMethod.bank.accountNumber', 'identity'], ['paymentMethod.bank.accountName', 'text'],
    ['paymentMethod.bank.routingNumber', 'identity'], ['paymentMethod.bank.swiftCode', 'identity'],
    ['paymentMethod.bkash.accountNumber', 'identity'], ['paymentMethod.bkash.accountName', 'text'],
  ],
}

export const VENDOR_PII = {
  'pii.contact.view': [
    ['userId.email', 'email'], ['userId.phone', 'phone'],
    ['email', 'email'], ['phone', 'phone'], ['contactName', 'text'],
  ],
  'pii.address.view': [
    ['address', 'address'],
  ],
}

export const INVOICE_PII = {
  'pii.contact.view': [
    ['clientId.userId.email', 'email'], ['clientId.userId.phone', 'phone'],
    ['billingEmail', 'email'], ['billingPhone', 'phone'],
  ],
  'pii.address.view': [
    ['billingAddress', 'address'],
  ],
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Mask a single record (mutates and returns the plain object).
 * @param {object} session — next-auth session
 * @param {object} doc     — plain JSON record (after .toJSON()/.lean())
 * @param {object} spec    — e.g. CLIENT_PII
 */
export function maskDoc(session, doc, spec) {
  if (!doc || typeof doc !== 'object') return doc
  for (const [perm, fields] of Object.entries(spec)) {
    if (canDo(session, perm)) continue // role is allowed to see this category
    for (const [path, type] of fields) {
      const cur = getPath(doc, path)
      if (cur == null) continue
      setPath(doc, path, (MASKERS[type] ?? maskText)(cur))
    }
  }
  return doc
}

/**
 * Mask an array of records. Returns the (mutated) array.
 */
export function maskList(session, docs, spec) {
  if (!Array.isArray(docs)) return docs
  for (const d of docs) maskDoc(session, d, spec)
  return docs
}

/**
 * True if the session may export unmasked data (used to gate CSV/Excel exports).
 */
export function canExportPII(session) {
  return canDo(session, 'pii.export')
}
