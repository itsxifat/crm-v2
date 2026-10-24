/**
 * lib/searchMatch.js
 *
 * Small search helpers:
 *   - ciEquals / ciContains: case-insensitive exact / substring Mongo filters.
 *   - codeIncludes: JS twin of codeContains (lib/codes.js) for lists filtered in the browser.
 *   - wordMatches: enum values a query names in words ('in progress' → IN_PROGRESS).
 *   - amountQuery / amountEquals / moneyOf: numeric search on (Mixed) money fields.
 *   - matchesAny: JS predicate for substring match across fields.
 *   - searchEncrypted: DB-level multi-field search + paginate (historical name).
 */

import { compactCode, codeContains } from '@/lib/codes'

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
 * JS twin of codeContains (lib/codes.js), for lists filtered in the browser:
 * true when the query's letters and digits appear in `value` with separators
 * and case ignored on both sides ('env2610' finds ENV-2610A001 and ENV2610A001).
 */
export function codeIncludes(value, query) {
  const q = compactCode(query)
  return q !== '' && value != null && compactCode(value).includes(q)
}

// 'In progress' → ['inprogress', 'progress']: the label, compacted, from each word on.
function wordTails(label) {
  const words = String(label ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return words.map((_, i) => words.slice(i).join(''))
}

/**
 * Enum values a free-text query names in words, for a field stored as a code
 * but shown as a label: wordMatches('in progress', { IN_PROGRESS: 'In progress',
 * ON_HOLD: 'On hold' }) → ['IN_PROGRESS'].
 * A value matches when the query, case, spaces and punctuation ignored, starts
 * at one of the words of its label(s) or of the value itself — 'progress',
 * 'in prog' and 'IN_PROGRESS' all name IN_PROGRESS. A query without a letter
 * names nothing, so amounts and record numbers never select a status.
 *
 * @param {string} query
 * @param {Record<string, string|string[]>} labels — value → label or labels
 * @returns {string[]}
 */
export function wordMatches(query, labels) {
  const q = String(query ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!/[a-z]/.test(q)) return []
  return Object.entries(labels)
    .filter(([value, names]) => [value, ...[].concat(names ?? [])]
      .some(name => wordTails(name).some(t => t.startsWith(q))))
    .map(([value]) => value)
}

/**
 * The amount a search query spells, or null: '15000', '15,000.50', '৳ 15,000',
 * 'Tk 15000', '15000 BDT', '15,000/-' → 15000 / 15000.5. Codes, names → null.
 */
export function amountQuery(query) {
  const s = String(query ?? '').replace(/৳|\/-|,|\s+|tk\.?|bdt/gi, '')
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null
}

/** Aggregation expression reading a Mixed money field as a number (0 when missing or not numeric). */
export function moneyOf(field) {
  return { $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } }
}

/**
 * Filter clause true when any of `exprs` (aggregation expressions yielding
 * numbers, e.g. moneyOf('total')) equals `amount` to the paisa. Money fields
 * are Mixed (numbers, or legacy strings), so they are compared as numbers via
 * $expr, never as text.
 */
export function amountEquals(amount, exprs) {
  return { $expr: { $or: exprs.map(e => ({ $lt: [{ $abs: { $subtract: [e, amount] } }, 0.005] })) } }
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
 * (case-insensitive substring $or over `fields`, separator-insensitive
 * codeContains over `codeFields`, exact case-insensitive `equals`), so every
 * record is searchable and `total` is exact.
 * (Kept under its historical name — fields used to be encrypted and were
 * filtered in JS over a capped window, which silently missed older rows.)
 *
 * @returns {Promise<{ docs: any[], total: number }>}
 */
export async function searchEncrypted(Model, {
  baseFilter = {},
  search,
  fields = [],
  codeFields = [],      // record numbers (QT00001 …): matched with separators ignored
  equals = [],          // [{ field, value }] exact (case-insensitive) matches
  page = 1,
  limit = 20,
  sort = { createdAt: -1 },
  populate = [],
  select = null,
}) {
  const q = String(search ?? '').trim()

  const and = [baseFilter]
  const or  = q ? fields.map(f => ({ [f]: ciContains(q) })) : []
  const code = q ? codeContains(q) : null
  if (code) for (const f of codeFields) or.push({ [f]: code })
  if (or.length) and.push({ $or: or })
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
