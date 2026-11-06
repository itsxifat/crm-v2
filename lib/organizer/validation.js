/**
 * lib/organizer/validation.js — zod building blocks and query-string parsers
 * shared by the /api/organizer routes.
 */
import { z } from 'zod'
import { isValidObjectId } from '@/lib/objectId'
import {
  PALETTE_KEYS, TAG_MAX_COUNT, TAG_MAX_LENGTH, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT,
} from './constants.js'
import { isYMD } from './dates.js'

// ── zod pieces ────────────────────────────────────────────────────────────────

export const paletteSchema = z.enum(PALETTE_KEYS)

export const objectIdSchema = z.string().refine(v => isValidObjectId(v), 'Invalid id')

/** Optional id that may be cleared with null (or ''). */
export const nullableIdSchema = z.preprocess(
  v => (v === '' ? null : v),
  objectIdSchema.nullable(),
).optional()

/** 'YYYY-MM-DD' (the UTC-midnight ISO form the API returns is accepted too). */
export const ymdSchema = z.string().refine(isYMD, 'Use a YYYY-MM-DD date')

/** Optional 'YYYY-MM-DD' that may be cleared with null (or ''). */
export const nullableYmdSchema = z.preprocess(v => (v === '' ? null : v), ymdSchema.nullable()).optional()

/** Optional free text; blank → null. */
export function optionalText(max) {
  return z.preprocess(
    v => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().max(max, `At most ${max} characters`).nullable(),
  ).optional()
}

/**
 * Tags: lowercase, trimmed, inner whitespace collapsed, blanks and duplicates
 * dropped. Arrays or comma-separated strings are accepted.
 */
export function normalizeTags(value) {
  if (value === null || value === undefined) return []
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null
  if (!raw) return value
  const out = []
  for (const t of raw) {
    if (typeof t !== 'string' && typeof t !== 'number') continue
    const tag = String(t).trim().toLowerCase().replace(/\s+/g, ' ')
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

export const tagsSchema = z.preprocess(
  normalizeTags,
  z.array(z.string().max(TAG_MAX_LENGTH, `Tags are at most ${TAG_MAX_LENGTH} characters`))
    .max(TAG_MAX_COUNT, `At most ${TAG_MAX_COUNT} tags`),
)

// ── query-string parsers ──────────────────────────────────────────────────────

function rawList(value) {
  if (value === null || value === undefined) return null
  const parts = String(value).split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : null
}

/**
 * Comma-separated ids → valid ids (invalid ones ignored).
 * null when the param is absent/empty (= no filter); [] when it named only
 * invalid ids (= match nothing — an invalid filter never widens the result).
 */
export function parseIdList(value) {
  const parts = rawList(value)
  if (!parts) return null
  return [...new Set(parts.filter(isValidObjectId))]
}

/** Comma-separated enum values (case-insensitive) → allowed values; same null/[] rules as parseIdList. */
export function parseEnumList(value, allowed) {
  const parts = rawList(value)
  if (!parts) return null
  const upper = parts.map(p => p.toUpperCase())
  return allowed.filter(a => upper.includes(a))
}

/** Comma-separated tags → normalised tags, or null. */
export function parseTagList(value) {
  const parts = rawList(value)
  if (!parts) return null
  const tags = normalizeTags(parts)
  return tags.length ? tags : null
}

/** page / limit / skip from search params. */
export function parsePaging(searchParams, { defaultLimit = DEFAULT_PAGE_LIMIT, maxLimit = MAX_PAGE_LIMIT } = {}) {
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const rawLimit = parseInt(searchParams.get('limit') ?? String(defaultLimit), 10)
  const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit))
  return { page, limit, skip: (page - 1) * limit }
}

/** Trimmed search text (≤ 100 chars) or ''. */
export function parseSearch(value) {
  return String(value ?? '').trim().slice(0, 100)
}

/** 'asc' | 'desc' from a dir param, falling back to `fallback`. */
export function parseDir(value, fallback) {
  const v = String(value ?? '').toLowerCase()
  return v === 'asc' || v === 'desc' ? v : fallback
}
