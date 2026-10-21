// Shared helpers for the /api/mail routes (private folder — not a route).
import { NextResponse } from 'next/server'
import { isValidObjectId } from '@/lib/objectId'

export { isValidObjectId }

export function jsonError(message, status) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Map a thrown error to the house JSON error shape. lib/mail errors carry
 * `.status` (400/403/404/409/422) with a human message; everything else is a 500.
 */
export function mailError(err, tag) {
  const status = Number(err?.status)
  if (status >= 400 && status < 500) {
    return NextResponse.json({ error: err.message || 'Request failed' }, { status })
  }
  if (err?.name === 'ValidationError') {
    const first = err.errors ? Object.values(err.errors)[0]?.message : null
    return NextResponse.json({ error: first || 'Validation failed' }, { status: 422 })
  }
  if (err?.name === 'CastError') {
    return NextResponse.json({ error: `Invalid value for ${err.path || 'a field'}` }, { status: 400 })
  }
  if (err?.code === 11000) {
    return NextResponse.json({ error: 'A record with these details already exists' }, { status: 409 })
  }
  console.error(tag, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** Parsed JSON body, or undefined when the body is missing / not JSON. */
export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

// ─── Cursor pagination (sort { date: -1, _id: -1 }) ──────────────────────────

export function encodeCursor(doc) {
  if (!doc) return null
  const d = doc.date ? new Date(doc.date).toISOString() : 'null'
  return Buffer.from(`${d}_${String(doc._id)}`).toString('base64url')
}

/** → { date: Date|null, id: string } or null when malformed. */
export function decodeCursor(cursor) {
  if (!cursor) return null
  try {
    const raw = Buffer.from(String(cursor), 'base64url').toString('utf8')
    const i = raw.lastIndexOf('_')
    if (i < 0) return null
    const d = raw.slice(0, i)
    const id = raw.slice(i + 1)
    if (!isValidObjectId(id)) return null
    if (d === 'null') return { date: null, id }
    const date = new Date(d)
    if (Number.isNaN(date.getTime())) return null
    return { date, id }
  } catch {
    return null
  }
}

/**
 * Filter for rows strictly after the cursor in { date: -1, _id: -1 } order.
 * Null dates sort last in descending order, so they always follow a dated cursor.
 */
export function afterCursor(cursor, toObjectId) {
  const id = toObjectId(cursor.id)
  if (cursor.date === null) return { date: null, _id: { $lt: id } }
  return {
    $or: [
      { date: { $lt: cursor.date } },
      { date: cursor.date, _id: { $lt: id } },
      { date: null },
    ],
  }
}

// ─── Binary responses ────────────────────────────────────────────────────────

// Types a browser could execute or render as a document from our origin.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript|application\/ecmascript|text\/ecmascript)\b/i

export function safeContentType(type) {
  const t = String(type || '').trim().toLowerCase()
  if (!t || ACTIVE_TYPES.test(t) || /[\r\n]/.test(t)) return 'application/octet-stream'
  return t
}

/** Inline display only for raster images and PDFs. */
export function canInline(type) {
  const t = String(type || '').toLowerCase()
  return (t.startsWith('image/') && !t.startsWith('image/svg')) || t === 'application/pdf'
}

/** RFC 6266 Content-Disposition with an ASCII fallback and RFC 5987 UTF-8 name. */
export function contentDisposition(kind, filename) {
  const name = String(filename || 'download').replace(/[\r\n\t\\/]+/g, ' ').trim() || 'download'
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["%;]/g, '_').trim() || 'download'
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
