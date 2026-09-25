/**
 * lib/searchMatch.js
 *
 * Small search helpers:
 *   - ciEquals / ciContains: case-insensitive exact / substring Mongo filters.
 *   - matchesAny: JS predicate for substring match across fields.
 *   - searchEncrypted: DB-level multi-field search + paginate (historical name).
 */

function getPath(obj, path) {
  if (!path.includes('.')) return obj?.[path]
  return path.split('.').reduce((cur, key) => cur?.[key], obj)
}

function escapeRegex(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive EXACT-match Mongo filter value: { $regex: '^value$', $options: 'i' }. */
export function ciEquals(value) {
  return { $regex: `^${escapeRegex(String(value ?? '').trim())}$`, $options: 'i' }
}

/** Case-insensitive CONTAINS Mongo filter value: { $regex: 'value', $options: 'i' }. */
export function ciContains(value) {
  return { $regex: escapeRegex(String(value ?? '').trim()), $options: 'i' }
}

/**
 * True if `query` (case-insensitive substring) appears in ANY of `fields` on doc.
 * @param {object} doc      — a decrypted Mongoose doc or plain object
 * @param {string[]} fields — field names (dot-paths allowed)
 * @param {string} query    — already-lowercased search term
 */
export function matchesAny(doc, fields, query) {
  if (!query) return true
  return fields.some(f => {
    const v = getPath(doc, f)
    return v != null && String(v).toLowerCase().includes(query)
  })
}

/**
 * Paginated search across several plaintext fields, done in the database
 * (case-insensitive substring $or over `fields`, exact case-insensitive
 * `equals`), so every record is searchable and `total` is exact.
 * (Kept under its historical name — fields used to be encrypted and were
 * filtered in JS over a capped window, which silently missed older rows.)
 *
 * @returns {Promise<{ docs: any[], total: number }>}
 */
export async function searchEncrypted(Model, {
  baseFilter = {},
  search,
  fields = [],
  equals = [],          // [{ field, value }] exact (case-insensitive) matches
  page = 1,
  limit = 20,
  sort = { createdAt: -1 },
  populate = [],
  select = null,
}) {
  const q = String(search ?? '').trim()

  const and = [baseFilter]
  if (q && fields.length) and.push({ $or: fields.map(f => ({ [f]: ciContains(q) })) })
  for (const e of equals) {
    if (e && e.value != null && e.value !== '') and.push({ [e.field]: ciEquals(e.value) })
  }
  const filter = and.length === 1 ? baseFilter : { $and: and }

  const safePage  = Math.max(1, Number(page) || 1)
  const safeLimit = Math.max(1, Number(limit) || 20)

  let query = Model.find(filter).sort(sort).skip((safePage - 1) * safeLimit).limit(safeLimit)
  if (select) query = query.select(select)
  for (const p of (Array.isArray(populate) ? populate : [populate])) {
    if (p) query = query.populate(p)
  }

  const [docs, total] = await Promise.all([query, Model.countDocuments(filter)])
  return { docs, total }
}
