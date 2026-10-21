// Gmail-style search operators → MailMessage filter. Pure (no DB access); safe to unit-test.
// Errors: none thrown — unknown operators / bad values degrade to free-text terms.
//
//   from:alice  to:"Bob Smith"  cc:x  subject:invoice  has:attachment
//   is:unread | is:read | is:starred  in:inbox|sent|drafts|spam|trash|archive
//   before:2026-01-31  after:2026-01-01  larger:5M  smaller:200K  "exact phrase"
import { ciContains } from '@/lib/searchMatch'
import { parseDhakaDay } from '@/lib/dhakaTime'

const MAX_QUERY = 500
const MAX_TERMS = 12

const ROLE_ALIASES = {
  inbox: 'INBOX',
  sent: 'SENT',
  drafts: 'DRAFTS',
  draft: 'DRAFTS',
  spam: 'SPAM',
  junk: 'SPAM',
  trash: 'TRASH',
  bin: 'TRASH',
  archive: 'ARCHIVE',
  archived: 'ARCHIVE',
}

// op:"quoted value" | op:value | "phrase" | word
const TOKEN_RE = /([a-z_]+):(?:"([^"]*)"?|(\S*))|"([^"]*)"?|(\S+)/gi

/** '5M' / '500k' / '1.5mb' / '2048' → bytes, or null. */
function parseSize(v) {
  const m = /^(\d+(?:\.\d+)?)\s*(k|kb|m|mb|g|gb|b)?$/i.exec(String(v).trim())
  if (!m) return null
  const n = Number(m[1])
  const unit = (m[2] || 'b')[0].toLowerCase()
  const mult = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1
  return Math.round(n * mult)
}

/** YYYY-MM-DD or YYYY/MM/DD (Dhaka calendar day) → Date at the start of that day, or null. */
function parseDay(v) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(v).trim())
  if (!m) return null
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return parseDhakaDay(iso)?.start ?? null
}

/**
 * Parse a search box value.
 * @returns {{ text: string[], from: string|null, to: string|null, cc: string|null, subject: string|null,
 *   hasAttachment: boolean|null, unread: boolean|null, starred: boolean|null, inRole: string|null,
 *   before: Date|null, after: Date|null, larger: number|null, smaller: number|null }}
 */
export function parseSearchQuery(q) {
  const out = {
    text: [],
    from: null,
    to: null,
    cc: null,
    subject: null,
    hasAttachment: null,
    unread: null,
    starred: null,
    inRole: null,
    before: null,
    after: null,
    larger: null,
    smaller: null,
  }
  const input = String(q ?? '').slice(0, MAX_QUERY)
  const addText = t => {
    const s = String(t ?? '').replace(/\s+/g, ' ').trim()
    if (s && out.text.length < MAX_TERMS) out.text.push(s)
  }

  for (const m of input.matchAll(TOKEN_RE)) {
    const [raw, opRaw, quotedVal, plainVal, phrase, word] = m
    if (word !== undefined) { addText(word); continue }
    if (phrase !== undefined) { addText(phrase); continue }

    const op = opRaw.toLowerCase()
    const value = String(quotedVal ?? plainVal ?? '').trim()
    if (!value) {
      // "from:" with nothing after it: the user is still typing, ignore it
      if (!['from', 'to', 'cc', 'subject', 'has', 'is', 'in', 'before', 'after', 'larger', 'smaller'].includes(op)) addText(raw)
      continue
    }
    const v = value.toLowerCase()

    switch (op) {
      case 'from':
      case 'to':
      case 'cc':
      case 'subject':
        out[op] = value
        break
      case 'has':
        if (['attachment', 'attachments', 'file', 'files'].includes(v)) out.hasAttachment = true
        else addText(raw)
        break
      case 'is':
        if (v === 'unread') out.unread = true
        else if (v === 'read') out.unread = false
        else if (v === 'starred' || v === 'flagged') out.starred = true
        else if (v === 'unstarred') out.starred = false
        else addText(raw)
        break
      case 'in':
        if (ROLE_ALIASES[v]) out.inRole = ROLE_ALIASES[v]
        else addText(raw)
        break
      case 'before':
      case 'after': {
        const d = parseDay(value)
        if (d) out[op] = d
        else addText(raw)
        break
      }
      case 'larger':
      case 'smaller': {
        const n = parseSize(value)
        if (n != null) out[op] = n
        else addText(raw)
        break
      }
      default:
        // Not an operator (e.g. "re:hello", a URL) → search it literally
        addText(raw)
    }
  }
  return out
}

const TEXT_FIELDS = ['subject', 'snippet', 'from.name', 'from.address', 'to.name', 'to.address']

function personClause(field, value) {
  return { $or: [{ [`${field}.address`]: ciContains(value) }, { [`${field}.name`]: ciContains(value) }] }
}

/**
 * Mongo filter fragment for MailMessage (merge with $and into the folder / account scope).
 * Returns {} when the query has no criteria.
 */
export function searchFilter(parsed) {
  const p = parsed ?? {}
  const and = []

  for (const term of p.text ?? []) {
    if (!term) continue
    and.push({ $or: TEXT_FIELDS.map(f => ({ [f]: ciContains(term) })) })
  }
  if (p.from) and.push(personClause('from', p.from))
  if (p.to) and.push(personClause('to', p.to))
  if (p.cc) and.push(personClause('cc', p.cc))
  if (p.subject) and.push({ subject: ciContains(p.subject) })
  if (p.hasAttachment === true) and.push({ hasAttachments: true })
  if (p.unread === true) and.push({ seen: false })
  if (p.unread === false) and.push({ seen: true })
  if (p.starred === true) and.push({ flagged: true })
  if (p.starred === false) and.push({ flagged: false })
  if (p.inRole) and.push({ folderRole: p.inRole })

  const date = {}
  if (p.after instanceof Date && !Number.isNaN(p.after.getTime())) date.$gte = p.after
  if (p.before instanceof Date && !Number.isNaN(p.before.getTime())) date.$lt = p.before
  if (Object.keys(date).length) and.push({ date })

  const size = {}
  if (Number.isFinite(p.larger)) size.$gt = p.larger
  if (Number.isFinite(p.smaller)) size.$lt = p.smaller
  if (Object.keys(size).length) and.push({ size })

  // Always $and (never a bare $or) so spreading it into a scope filter can't clobber the scope's own $or.
  return and.length ? { $and: and } : {}
}

/** True when the parsed query has any criteria at all. */
export function hasSearchCriteria(parsed) {
  return Object.keys(searchFilter(parsed)).length > 0
}
