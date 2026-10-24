/**
 * lib/units.js — PURE helpers (client-safe) for the business unit a money record
 * belongs to. See docs/ventures-and-products.md.
 *
 * Every money record (Transaction, ProjectExpense, Invoice) carries `unit`:
 *   'VENTURE:<ventureId>'  a venture, e.g. VENTURE:ENTECH
 *   'PRODUCT:<productId>'  a product (its own business unit), e.g. PRODUCT:ENVO
 *   'COMPANY'              company-wide / shared cost or income
 *   null                   Unassigned — only old rows the backfill could not place
 *
 * `config` is the parsed crm_config object: { ventures: [{ id, label, prefix,
 * description, active }], products: [{ id, label, description, active }], … }.
 * A venture or product with active === false is hidden from pickers, but its
 * history still reports under it.
 */

export const COMPANY_UNIT = 'COMPANY'
// Query-parameter value meaning `unit: null` (rows not placed in any unit).
export const UNASSIGNED = 'UNASSIGNED'

export const UNIT_KIND_LABELS = { VENTURE: 'Ventures', PRODUCT: 'Products', COMPANY: 'Company' }

const COMPANY_LABEL    = 'Company / shared'
const UNASSIGNED_LABEL = 'Unassigned'

const idText = (id) => (id === null || id === undefined ? '' : String(id).trim())

/** 'VENTURE:ENTECH' for a venture id; null for an empty id. */
export function ventureUnit(id) {
  const s = idText(id)
  return s ? `VENTURE:${s}` : null
}

/** 'PRODUCT:ENVO' for a product id; null for an empty id. */
export function productUnit(id) {
  const s = idText(id)
  return s ? `PRODUCT:${s}` : null
}

/**
 * { kind: 'VENTURE' | 'PRODUCT' | 'COMPANY', id } for a stored unit value
 * (id null for COMPANY); null for null, UNASSIGNED or anything malformed.
 */
export function parseUnit(unit) {
  if (typeof unit !== 'string') return null
  const s = unit.trim()
  if (s === COMPANY_UNIT) return { kind: 'COMPANY', id: null }
  const m = /^(VENTURE|PRODUCT):(\S.*)$/.exec(s)
  if (!m) return null
  const id = m[2].trim()
  return id ? { kind: m[1], id } : null
}

const listOf = (config, key) => (Array.isArray(config?.[key]) ? config[key] : [])
const findById = (list, id) => list.find(x => x && String(x.id) === id) ?? null

/**
 * true for COMPANY, or for a venture / product whose id exists in `config`
 * (active or not). Use it to validate a unit a person submitted.
 */
export function isValidUnit(unit, config) {
  const p = parseUnit(unit)
  if (!p) return false
  if (p.kind === 'COMPANY') return true
  return !!findById(listOf(config, p.kind === 'VENTURE' ? 'ventures' : 'products'), p.id)
}

/**
 * Picker options: ventures, then products, then Company / shared.
 * [{ value, label, kind, active }]. Inactive ventures / products are left out
 * unless includeInactive (then their label ends in "(inactive)").
 */
export function unitOptions(config, { includeInactive = false } = {}) {
  const build = (list, kind, toUnit) => list
    .filter(x => x && idText(x.id) && (includeInactive || x.active !== false))
    .map(x => {
      const active = x.active !== false
      const label = String(x.label || x.id).trim()
      return { value: toUnit(x.id), label: active ? label : `${label} (inactive)`, kind, active }
    })
  return [
    ...build(listOf(config, 'ventures'), 'VENTURE', ventureUnit),
    ...build(listOf(config, 'products'), 'PRODUCT', productUnit),
    { value: COMPANY_UNIT, label: COMPANY_LABEL, kind: 'COMPANY', active: true },
  ]
}

/**
 * Display name: 'Enfinito Tech' · 'Envo (product)' · 'Company / shared' ·
 * 'Unassigned' (null / UNASSIGNED). A venture or product no longer in the
 * config shows its id; anything malformed shows as stored.
 */
export function unitLabel(unit, config) {
  if (unit === null || unit === undefined || unit === '' || unit === UNASSIGNED) return UNASSIGNED_LABEL
  const p = parseUnit(unit)
  if (!p) return String(unit)
  if (p.kind === 'COMPANY') return COMPANY_LABEL
  if (p.kind === 'VENTURE') return findById(listOf(config, 'ventures'), p.id)?.label || p.id
  return `${findById(listOf(config, 'products'), p.id)?.label || p.id} (product)`
}
