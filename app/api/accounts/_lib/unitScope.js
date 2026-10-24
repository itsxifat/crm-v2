/**
 * app/api/accounts/_lib/unitScope.js — business-unit filters shared by the
 * finance report routes (units report, P&L report, summary, transactions list,
 * dashboard stats).
 *
 * Every money row carries `unit`: 'VENTURE:<id>' | 'PRODUCT:<id>' | 'COMPANY',
 * or null (Unassigned: old rows the backfill could not place). Reports take an
 * optional `unit` query parameter (an exact unit value, or UNASSIGNED for null)
 * and are always limited to the viewer's finance scope (lib/finance/scope.js):
 * Super Admin / finance.units.all see every unit, anyone else only their own.
 *
 * Invoices are receivables, not ledger rows: an invoice's unit is its own
 * `unit` when set, else its project's venture, else COMPANY — the same rule the
 * settlement of that invoice is booked under.
 */

import { Project } from '@/models'
import { COMPANY_UNIT, UNASSIGNED, parseUnit, ventureUnit } from '@/lib/units'
import { scopeFilter } from '@/lib/finance/scope'

/**
 * Read the `unit` query parameter.
 * @returns {{ unit?: string|null, error?: string }}
 *   unit undefined ⇒ no unit filter; null ⇒ Unassigned rows; a string ⇒ that unit.
 */
export function readUnitParam(searchParams, name = 'unit') {
  const raw = searchParams.get(name)?.trim()
  if (!raw) return { unit: undefined }
  if (raw === UNASSIGNED) return { unit: null }
  if (!parseUnit(raw)) return { error: 'Invalid unit' }
  return { unit: raw }
}

/**
 * `filter` limited to the viewer's scope and, when given, one unit (undefined ⇒
 * every unit in scope, null ⇒ Unassigned). The conditions are ANDed, so an
 * existing `$or` / `$and` in `filter` keeps working.
 */
export function unitFilter(filter, scope, unit, field = 'unit') {
  const conds = []
  const scoped = scopeFilter(scope, field)
  if (Object.keys(scoped).length) conds.push(scoped)
  if (unit !== undefined) conds.push({ [field]: unit })
  if (!conds.length) return filter
  return { ...filter, $and: [...(filter.$and ?? []), ...conds] }
}

/** True when a row of `unit` (null = Unassigned) is inside the viewer's scope. */
export function inScope(scope, unit) {
  if (!scope || scope.all) return true
  return unit != null && (scope.units ?? []).includes(unit)
}

/** True when a row of `unit` is in scope and matches the `unit` parameter (see readUnitParam). */
export function unitVisible(scope, unit, param) {
  if (!inScope(scope, unit)) return false
  if (param === undefined) return true
  return param === null ? unit == null : unit === param
}

/** The unit value as the API returns it: null (Unassigned) becomes UNASSIGNED. */
export function unitKey(unit) {
  return unit == null || unit === '' ? UNASSIGNED : unit
}

/**
 * Unit of each invoice: its own `unit`, else the venture of its project
 * (projectId, or the first of a legacy projectIds list), else COMPANY.
 * @param {Array<{ _id, unit?, projectId?, projectIds? }>} invoices
 * @returns {Promise<Map<string, string>>} invoice id → unit
 */
export async function invoiceUnits(invoices) {
  const projectOf = (inv) => inv.projectId ?? inv.projectIds?.[0] ?? null
  const ids = [...new Set(invoices.filter(inv => !inv.unit).map(projectOf).filter(Boolean).map(String))]
  const projects = ids.length ? await Project.find({ _id: { $in: ids } }).select('venture').lean() : []
  const ventureOf = new Map(projects.map(p => [String(p._id), p.venture]))
  const out = new Map()
  for (const inv of invoices) {
    const pid = projectOf(inv)
    const unit = inv.unit || (pid ? ventureUnit(ventureOf.get(String(pid))) : null) || COMPANY_UNIT
    out.set(String(inv._id), unit)
  }
  return out
}
