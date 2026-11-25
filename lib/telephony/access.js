/**
 * lib/telephony/access.js — SERVER-ONLY: who may use the phone in the CRM.
 *
 * A staff member calls when a Super Admin has given them an Envo extension
 * (Configuration → Calling). The extension is the grant: there is no separate
 * permission, so custom roles never need updating. What the caller panel shows about
 * a client or lead still follows the person's permissions (lib/telephony/lookup.js).
 */
import { getPhoneSettings, phoneReady } from '@/lib/integrations/settings'

export const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

export const isStaff = (session) => !!session?.user?.id && STAFF_ROLES.includes(session.user.role)

/**
 * { ok: true, settings, extension } when this person can call, else
 * { ok: false, status, reason } saying why not.
 */
export async function phoneAccess(session) {
  if (!isStaff(session)) return { ok: false, status: 403, reason: 'Calling is for staff accounts' }
  const settings = await getPhoneSettings()
  if (!phoneReady(settings)) {
    return { ok: false, status: 503, reason: 'Calling through Envo is not set up yet (Configuration → Calling)' }
  }
  const extension = settings.extensions?.[session.user.id] || null
  if (!extension) {
    return { ok: false, status: 403, reason: 'No Envo extension is assigned to you yet. A Super Admin can assign one in Configuration → Calling.' }
  }
  return { ok: true, settings, extension: String(extension) }
}

/** Which staff member an extension belongs to (internal calls), or null. */
export function userIdForExtension(settings, extension) {
  const ext = String(extension ?? '')
  if (!ext) return null
  for (const [userId, e] of Object.entries(settings?.extensions ?? {})) if (String(e) === ext) return userId
  return null
}
