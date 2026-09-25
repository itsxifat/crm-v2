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

/** Fully hidden token for values with no safe partial form (document URLs, dates). */
export function maskSecret(v) {
  if (v == null) return v
  return DOT.repeat(6)
}

const MASKERS = {
  secret:   maskSecret,
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

/**
 * Apply `fn` to the value at `path`. A `[]` suffix on a segment maps over an
 * array, e.g. 'emergencyContacts[].phone' or 'kyc.additionalDocs[].url'.
 */
function maskPath(obj, path, fn) {
  const i = path.indexOf('[]')
  if (i === -1) {
    const cur = getPath(obj, path)
    if (cur != null) setPath(obj, path, fn(cur))
    return
  }
  const arr  = getPath(obj, path.slice(0, i))
  const rest = path.slice(i + 2).replace(/^\./, '')
  if (!Array.isArray(arr)) return
  for (let k = 0; k < arr.length; k++) {
    if (!rest) { if (arr[k] != null && typeof arr[k] !== 'object') arr[k] = fn(arr[k]) }
    else if (arr[k] && typeof arr[k] === 'object') maskPath(arr[k], rest, fn)
  }
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
    ['kyc.additionalDocs[].url', 'secret'],
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
    ['emergencyContacts[].phone', 'phone'],
  ],
  'pii.address.view': [
    ['address', 'address'],
  ],
  'pii.identity.view': [
    ['nidNumber', 'identity'], ['passportNumber', 'identity'],
    ['dateOfBirth', 'secret'], ['documents[].url', 'secret'],
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
    ['agencyInfo.address', 'address'], ['address', 'address'],
  ],
  'pii.identity.view': [
    ['nidNumber', 'identity'], ['passportNumber', 'identity'],
    ['documents[].url', 'secret'], ['kycDocuments[].url', 'secret'],
  ],
  'pii.financial.view': [
    ['salaryAmount', 'money'],
    ['salaryPayouts[].amount', 'money'], ['salaryPayouts[].amountBDT', 'money'],
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
  // Invoices populate the full Client record — mask everything CLIENT_PII hides.
  'pii.contact.view': [
    ['clientId.userId.email', 'email'], ['clientId.userId.phone', 'phone'],
    ['clientId.companyEmail', 'email'], ['clientId.companyPhone', 'phone'], ['clientId.altPhone', 'phone'],
    ['clientId.website', 'text'],
  ],
  'pii.address.view': [
    ['clientId.address', 'address'], ['clientId.city', 'text'], ['clientId.country', 'text'],
    ['clientId.timezone', 'text'],
  ],
  'pii.identity.view': [
    ['clientId.vatNumber', 'identity'],
    ['clientId.kyc.documentNumber', 'identity'], ['clientId.kyc.primaryDoc', 'identity'],
    ['clientId.kyc.additionalDocs[].url', 'secret'],
  ],
}

// Bare User records (user directory / single-user lookups).
export const USER_PII = {
  'pii.contact.view': [
    ['email', 'email'], ['phone', 'phone'],
  ],
}

// Quotations: the recipient snapshot is a copy of lead / client contact data.
export const QUOTATION_PII = {
  'pii.contact.view': [
    ['recipientEmail', 'email'], ['recipientPhone', 'phone'],
  ],
  'pii.address.view': [
    ['recipientAddress', 'address'],
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
      maskPath(doc, path, MASKERS[type] ?? maskText)
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

// ── Round-trip protection (incoming writes) ──────────────────────────────────
// Edit forms are pre-filled from masked GET responses, so a PUT/PATCH may post
// the placeholder (e.g. "j•••@g••.com", "••••••") straight back. Writing that
// would destroy the real value. Every masker above emits at least two
// consecutive DOTs, which real data practically never contains.

const MASK_MARK = DOT.repeat(2)

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** True if `v` is a masked placeholder string produced by this module. */
export function isMaskedValue(v) {
  return typeof v === 'string' && v.includes(MASK_MARK)
}

/** True if `v` is, or deeply contains (plain objects / arrays), a masked value. */
export function containsMaskedValue(v) {
  if (isMaskedValue(v)) return true
  if (Array.isArray(v)) return v.some(containsMaskedValue)
  if (isPlainObject(v)) return Object.values(v).some(containsMaskedValue)
  return false
}

/**
 * Return a copy of an incoming request body with every masked placeholder
 * removed, so it is never written over the real value. Apply to the RAW body
 * before validation (masked strings fail email/number schemas).
 *   • Plain-object keys whose value is masked are dropped (recursively).
 *   • An array that contains a masked value anywhere is dropped as a whole
 *     (removing one element would shift indexes / overwrite the stored array).
 *   • Non-plain values (Date, ObjectId, …) are passed through untouched.
 * CAVEAT: a nested object that loses a masked leaf is still a partial object;
 * if the route assigns nested objects wholesale (e.g. findByIdAndUpdate(id,
 * { paymentMethod })) the stripped leaf would be cleared — use
 * restoreMaskedValues(body, existing) in that case instead.
 * @param {any} body
 * @returns {any}
 */
export function stripMaskedValues(body) {
  if (isMaskedValue(body)) return undefined
  if (Array.isArray(body)) return containsMaskedValue(body) ? undefined : body
  if (!isPlainObject(body)) return body
  const out = {}
  for (const [k, v] of Object.entries(body)) {
    const cleaned = stripMaskedValues(v)
    if (cleaned === undefined && v !== undefined) continue
    out[k] = cleaned
  }
  return out
}

/**
 * Return a copy of an incoming body where every masked placeholder is replaced
 * by the real value at the same path in `existing` (the stored record, ideally
 * `.lean()`); arrays are matched by index. A masked value with no counterpart
 * in `existing` is dropped. Safe for routes that replace nested objects/arrays
 * wholesale, since the restored object is complete.
 * @param {any} body     — incoming (possibly masked) request data
 * @param {any} existing — current stored record (plain object)
 * @returns {any}
 */
export function restoreMaskedValues(body, existing) {
  if (isMaskedValue(body)) return existing == null ? undefined : existing
  if (Array.isArray(body)) {
    const out = []
    for (let i = 0; i < body.length; i++) {
      const r = restoreMaskedValues(body[i], Array.isArray(existing) ? existing[i] : undefined)
      if (r === undefined && body[i] !== undefined) return existing // can't restore → keep stored array
      out.push(r)
    }
    return out
  }
  if (!isPlainObject(body)) return body
  const out = {}
  for (const [k, v] of Object.entries(body)) {
    const r = restoreMaskedValues(v, existing != null ? existing[k] : undefined)
    if (r === undefined && v !== undefined) continue
    out[k] = r
  }
  return out
}
