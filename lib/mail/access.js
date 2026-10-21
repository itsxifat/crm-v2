// Server-only: who can use which mailbox.
//
//   - SUPER_ADMIN, or anyone with `mail.manage`, administers accounts and can
//     use every active mailbox.
//   - Other staff can only use accounts whose `assignedUsers` contains them.
import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { canDo } from '@/lib/rbac'
import { MailAccount } from '@/models'

const STAFF = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

export function isStaff(session) {
  return STAFF.includes(session?.user?.role)
}

export function canManageMail(session) {
  if (!isStaff(session)) return false
  return session.user.role === 'SUPER_ADMIN' || canDo(session, 'mail.manage')
}

/** Mongo filter of the active accounts this session may use. */
export function accessibleAccountFilter(session) {
  if (canManageMail(session)) return { isActive: true }
  return { isActive: true, assignedUsers: new mongoose.Types.ObjectId(session.user.id) }
}

/** ObjectIds of the active accounts this session may use. */
export async function accessibleAccountIds(session) {
  if (!isStaff(session)) return []
  const rows = await MailAccount.find(accessibleAccountFilter(session)).select('_id').lean()
  return rows.map(r => r._id)
}

/** True if the session may use this account (account doc or lean object with assignedUsers/isActive). */
export function canUseAccount(session, account) {
  if (!account || !isStaff(session)) return false
  if (canManageMail(session)) return true
  if (!account.isActive) return false
  const uid = String(session.user.id)
  return (account.assignedUsers ?? []).some(u => String(u?._id ?? u) === uid)
}

/**
 * Resolve the `accountId` query value ('all' / missing / an id) to the list of
 * account ObjectIds to query, limited to what the session can use.
 * Returns null when a specific id was requested but isn't accessible.
 */
export async function resolveAccountScope(session, accountId) {
  const ids = await accessibleAccountIds(session)
  if (!accountId || accountId === 'all') return ids
  const hit = ids.find(id => String(id) === String(accountId))
  return hit ? [hit] : null
}

// ─── Route guards (return a NextResponse to short-circuit, or null) ───────────

export function requireMailUser(session) {
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!isStaff(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export function requireMailManager(session) {
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!canManageMail(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

/**
 * Load an account the session may use. Returns { account } or { error: NextResponse }.
 * `select` lets callers add fields (never '+password' — use credentials.loadAccountWithSecret).
 */
export async function getUsableAccount(session, accountId, select) {
  if (!mongoose.isValidObjectId(accountId)) {
    return { error: NextResponse.json({ error: 'Mailbox not found' }, { status: 404 }) }
  }
  const q = MailAccount.findById(accountId)
  if (select) q.select(select)
  const account = await q.lean()
  if (!account || !canUseAccount(session, account)) {
    return { error: NextResponse.json({ error: 'Mailbox not found' }, { status: 404 }) }
  }
  return { account }
}
