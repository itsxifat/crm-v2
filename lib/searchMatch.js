/**
 * lib/searchMatch.js
 *
 * Small search helpers:
 *   - ciEquals / ciContains: case-insensitive exact / substring Mongo filters.
 *   - matchesAny: JS predicate for substring match across fields.
 *   - searchEncrypted: capped fetch + JS filter + paginate. (Named for its
 *     original use against encrypted fields; works fine on plaintext too and is
 *     handy when a search must span fields you don't want to index.)
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
 * Paginated, in-JS search for a model with encrypted searchable fields.
 * Applies `baseFilter` (non-encrypted constraints + ownership scoping) at the DB
 * level, decrypts via the post-find hook, then filters by `search` across
 * `fields` and paginates the matched set in JS.
 *
 * Only use this branch when a search term is present; without one, keep the
 * normal DB-paginated path (far cheaper).
 *
 * @returns {Promise<{ docs: any[], total: number }>}
 */
export async function searchEncrypted(Model, {
  baseFilter = {},
  search,
  fields = [],
  equals = [],          // [{ field, value }] exact (case-insensitive) matches on encrypted fields
  page = 1,
  limit = 20,
  sort = { createdAt: -1 },
  cap = 2000,
  populate = [],
  select = null,
}) {
  const q = String(search ?? '').toLowerCase().trim()

  let query = Model.find(baseFilter).sort(sort).limit(cap)
  if (select) query = query.select(select)
  for (const p of (Array.isArray(populate) ? populate : [populate])) {
    query = query.populate(p)
  }

  const all     = await query                       // decrypted by post-find hook
  const activeEquals = equals.filter(e => e && e.value != null && e.value !== '')
  const matched = all.filter(doc => {
    if (q && !matchesAny(doc, fields, q)) return false
    for (const { field, value } of activeEquals) {
      if (String(getPath(doc, field) ?? '').toLowerCase() !== String(value).toLowerCase()) return false
    }
    return true
  })
  const total = matched.length
  const start = (page - 1) * limit
  const docs  = matched.slice(start, start + limit)

  return { docs, total }
}
