/**
 * Server-only helpers shared by the self-service "My Assets" routes, the
 * employee Assets tab API and the physical-audit routes (I4).
 *
 * `_lib` is a private folder: Next.js never routes it.
 */

import { Employee, User, CustomRole } from '@/models'
import { applyPermissionOverrides, DEFAULT_ROLE_PERMISSIONS } from '@/lib/rbac'

/** Permissions whose holders look after assets and should hear about problems. */
export const INVENTORY_NOTIFY_PERMS = ['inventory.manage', 'inventory.assign']

/** /uploads/<bucket>/<uuid>.<ext> — the only URLs our own upload route returns. */
export { UPLOAD_URL_RE } from '@/lib/inventory/constants'

export const REPORT_TYPES = ['DAMAGE', 'NOT_WORKING', 'LOST']

export const REPORT_TYPE_META = {
  DAMAGE:      { label: 'Damage',      verb: 'damaged',            eventType: 'DAMAGE_REPORTED' },
  NOT_WORKING: { label: 'Not working', verb: 'is not working',     eventType: 'DAMAGE_REPORTED' },
  LOST:        { label: 'Lost',        verb: 'is lost or missing', eventType: 'LOST' },
}

const idStr = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v._id !== undefined) return String(v._id)
  return String(v)
}

/** The Employee record behind the signed-in user (null for staff without one, e.g. some admins). */
export async function employeeForSession(session) {
  const userId = session?.user?.id
  if (!userId) return null
  return Employee.findOne({ userId })
    .select('_id userId employeeId department designation position isActive resigned')
    .lean()
}

/**
 * Active staff users whose EFFECTIVE permissions include any of `perms`
 * (custom role + individual overrides, exactly like lib/auth resolves them).
 * SUPER_ADMIN always qualifies. Never throws — returns [] on failure.
 *
 * @param {{ perms?: string[], excludeUserId?: string|null }} [opts]
 * @returns {Promise<string[]>} user ids
 */
export async function inventoryManagerUserIds({ perms = INVENTORY_NOTIFY_PERMS, excludeUserId = null } = {}) {
  try {
    const users = await User.find({ role: { $in: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] }, isActive: true })
      .select('_id role').lean()
    const staff = users.filter(u => u.role !== 'SUPER_ADMIN')
    const emps = staff.length
      ? await Employee.find({ userId: { $in: staff.map(u => u._id) } }).select('userId customRoleId permissionOverrides').lean()
      : []
    const empByUser = new Map(emps.map(e => [String(e.userId), e]))
    const roleIds = [...new Set(emps.map(e => idStr(e.customRoleId)).filter(Boolean))]
    const roles = roleIds.length ? await CustomRole.find({ _id: { $in: roleIds } }).select('permissions').lean() : []
    const roleById = new Map(roles.map(r => [String(r._id), Array.isArray(r.permissions) ? r.permissions : []]))

    const out = []
    for (const u of users) {
      const id = String(u._id)
      if (excludeUserId && id === String(excludeUserId)) continue
      if (u.role === 'SUPER_ADMIN') { out.push(id); continue }
      const emp = empByUser.get(id)
      const overrides = emp?.permissionOverrides
      const rolePerms = emp?.customRoleId ? roleById.get(String(emp.customRoleId)) : undefined
      let effective
      if (rolePerms) effective = applyPermissionOverrides(rolePerms, overrides)
      else if (overrides?.added?.length || overrides?.removed?.length) {
        effective = applyPermissionOverrides(DEFAULT_ROLE_PERMISSIONS[u.role] ?? [], overrides)
      } else effective = DEFAULT_ROLE_PERMISSIONS[u.role] ?? []
      if (perms.some(p => effective.includes(p))) out.push(id)
    }
    return out
  } catch (err) {
    console.error('[inventoryManagerUserIds]', err)
    return []
  }
}

/** Display name of an Employee populated with userId { name }. */
export function employeeName(emp) {
  if (!emp || typeof emp !== 'object') return null
  return emp.userId?.name ?? emp.name ?? emp.employeeId ?? null
}

const pickRef = (ref, fields) => {
  if (!ref || typeof ref !== 'object' || ref._id === undefined) return null
  const out = { id: String(ref._id) }
  for (const f of fields) out[f] = ref[f] ?? null
  return out
}

/**
 * Employee-safe view of an asset (no cost, purchase, depreciation or disposal data).
 * Expects a lean asset with categoryId / locationId populated.
 */
export function toMyAsset(a, { lastReport = null } = {}) {
  return {
    id:                 String(a._id),
    assetTag:           a.assetTag,
    name:               a.name,
    category:           pickRef(a.categoryId, ['name', 'code']),
    brand:              a.brand ?? null,
    model:              a.model ?? null,
    serialNumber:       a.serialNumber ?? null,
    specs:              a.specs ?? null,
    description:        a.description ?? null,
    imageUrl:           a.imageUrl ?? null,
    status:             a.status,
    condition:          a.condition ?? null,
    location:           pickRef(a.locationId, ['name', 'code']),
    assignedAt:         a.assignedAt ?? null,
    expectedReturnDate: a.expectedReturnDate ?? null,
    warrantyExpiry:     a.warrantyExpiry ?? null,
    acknowledgement: {
      status: a.acknowledgement?.status ?? 'NOT_REQUIRED',
      at:     a.acknowledgement?.at ?? null,
      note:   a.acknowledgement?.note ?? null,
    },
    lastReport,
  }
}

/** Compact summary of a self-service report event for the UI. */
export function toReportSummary(ev) {
  if (!ev) return null
  return {
    id:          String(ev._id),
    type:        ev.details?.reportType ?? (ev.type === 'LOST' ? 'LOST' : 'DAMAGE'),
    date:        ev.date,
    description: ev.details?.description ?? ev.notes ?? null,
  }
}
