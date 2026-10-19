/**
 * Permission guard shared by the B4 tax routes: pass when the session holds
 * ANY of the given permissions (mirrors ROUTE_PERMISSIONS '/admin/tax' →
 * ['tax.view', 'tax.manage'], so a tax manager can read what they manage).
 */
import { NextResponse } from 'next/server'
import { canDoAny } from '@/lib/rbac'

export const TAX_READ_PERMS = ['tax.view', 'tax.manage']

/** null to proceed, else a 401 'Unauthorised' / 403 'Forbidden' response. */
export function requireAnyPerm(session, perms = TAX_READ_PERMS) {
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!canDoAny(session, perms)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}
