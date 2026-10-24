/**
 * lib/finance/scope.js — SERVER-ONLY: which business units (lib/units.js) a
 * person may see in finance reports.
 *
 * Super Admin, and anyone granted `finance.units.all`, sees every venture,
 * product, Company / shared and Unassigned. Everyone else sees only their own
 * venture (Employee.venture); no venture ⇒ nothing.
 *
 *   const scope = await financeScope(session)
 *   Transaction.find({ ...match, ...scopeFilter(scope) })
 */

import connectDB from '@/lib/mongodb'
import { Employee } from '@/models'
import { canDo } from '@/lib/rbac'
import { ventureUnit } from '@/lib/units'

export const ALL_UNITS_PERMISSION = 'finance.units.all'

/**
 * @param {object} session — next-auth session
 * @returns {Promise<{ all: true } | { all: false, units: string[] }>}
 */
export async function financeScope(session) {
  const user = session?.user
  if (!user) return { all: false, units: [] }
  if (user.role === 'SUPER_ADMIN' || canDo(session, ALL_UNITS_PERMISSION)) return { all: true }
  if (!user.id) return { all: false, units: [] }

  await connectDB()
  const employee = await Employee.findOne({ userId: user.id }).select('venture').lean()
  const venture = typeof employee?.venture === 'string' ? employee.venture.trim() : ''
  // A value still in the old `enc:v1:` ciphertext (scripts/decrypt-migrate.js) is no venture id.
  const unit = venture && !venture.startsWith('enc:') ? ventureUnit(venture) : null
  return { all: false, units: unit ? [unit] : [] }
}

/**
 * Mongo filter for a scope: {} when all, else { [field]: { $in: units } }
 * (an empty list matches nothing).
 */
export function scopeFilter(scope, field = 'unit') {
  if (scope?.all) return {}
  return { [field]: { $in: Array.isArray(scope?.units) ? scope.units : [] } }
}
