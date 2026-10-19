/**
 * Shared server helpers for finance period locks, opening-balance routes and
 * the finance settings route (B2). Not a route — private `_lib` folder.
 */

import { NextResponse } from 'next/server'
import { canDoAny } from '@/lib/rbac'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { isDayKey, dayKeyLabel } from '@/lib/finance/fiscal'

/** AuditLog `entity` values written by B2 (history of settings, locks and openings). */
export const FINANCE_AUDIT_ENTITIES = ['FINANCE_SETTINGS', 'OPENING_BALANCE']

/** Minimum reason length for any unlock. */
export const UNLOCK_REASON_MIN = 10
export const REASON_MAX = 500

/** Lock fields that can be moved through /api/finance/periods. */
export const LOCK_FIELDS = {
  lockedUntil:    'Books',
  taxLockedUntil: 'Tax (VAT) period',
}

/** 401 / 403 NextResponse unless the session holds ANY of `perms`; null to proceed. */
export function requireAny(session, perms) {
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!canDoAny(session, perms)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export const isSuperAdmin = (session) => session?.user?.role === 'SUPER_ADMIN'

/** Error carrying an HTTP status (mapped to `{ error }` by the routes). */
export function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

/** Map an error with `.status` to a JSON response, else 500 with a console line. */
export function errorResponse(err, tag) {
  if (err?.status && err.status >= 400 && err.status < 500) {
    const body = { error: err.message }
    if (typeof err.code === 'string') body.code = err.code
    if (err.field) body.field = err.field
    if (err.details) body.details = err.details
    return NextResponse.json(body, { status: err.status })
  }
  console.error(tag, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** Trimmed reason string ('' when absent); throws 422 when too long. */
export function cleanReason(reason) {
  const why = String(reason ?? '').trim()
  if (why.length > REASON_MAX) throw httpError(422, `Reason is too long (max ${REASON_MAX} characters)`)
  return why
}

/**
 * Validate moving a lock date (`lockedUntil` / `taxLockedUntil`).
 *  - the new value is null (no lock) or a valid 'YYYY-MM-DD' not after today (Dhaka);
 *  - moving it back (or clearing it) unlocks a period: SUPER_ADMIN only, reason ≥ 10 chars.
 * @returns {{ field, from, to, unchanged: boolean, action?: 'LOCK'|'UNLOCK', reason: string }}
 */
export function checkLockChange({ field, current, next, reason, session }) {
  const label = LOCK_FIELDS[field] ?? field
  const to = next === '' || next === undefined ? null : next
  if (to !== null && (typeof to !== 'string' || !isDayKey(to))) {
    throw httpError(422, `${label} lock date must be a valid date (YYYY-MM-DD)`, { field })
  }
  const today = dhakaDayKey(new Date())
  if (to && to > today) {
    throw httpError(422, `${label} cannot be locked beyond today (${dayKeyLabel(today)})`, { field })
  }
  const from = current || null
  const why = cleanReason(reason)
  if (from === to) return { field, from, to, unchanged: true, reason: why }

  const backwards = !!from && (to === null || to < from)
  if (backwards) {
    if (!isSuperAdmin(session)) {
      throw httpError(403, 'Only a super admin can move a lock date back (unlock a period)', { field })
    }
    if (why.length < UNLOCK_REASON_MIN) {
      throw httpError(422, `Give a reason of at least ${UNLOCK_REASON_MIN} characters for unlocking`, { field })
    }
  }
  return { field, from, to, unchanged: false, action: backwards ? 'UNLOCK' : 'LOCK', reason: why }
}

/**
 * 409 BOOKS_LOCKED error for an opening balance dated on/before the books lock
 * (`lockedUntil`). Opening balances are exempt from the VAT lock only — a
 * closed books period must not change through the opening wizard either.
 */
export function booksLockedError(lockedUntil, what = 'this opening balance is dated in the locked period', extra = {}) {
  return httpError(409, `Books are locked up to ${dayKeyLabel(lockedUntil)} — ${what}. Unlock the period first.`, { code: 'BOOKS_LOCKED', ...extra })
}

/** Human summary of a lock change for audit logs and toasts. */
export function describeLockChange({ field, from, to }) {
  const label = LOCK_FIELDS[field] ?? field
  const f = from ? dayKeyLabel(from) : 'not locked'
  const t = to ? dayKeyLabel(to) : 'not locked'
  return `${label} lock: ${f} → ${t}`
}
