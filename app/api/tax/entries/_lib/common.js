/**
 * app/api/tax/entries/_lib/common.js — SERVER-ONLY helpers shared by the B3 tax
 * operation routes (summary, entries, deposits, certificates, withholding return).
 *
 * `_lib` is a private folder (underscore prefix), so Next.js never routes it.
 */

import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { round2, TAX_ENTRY_TYPES, vatReturnOverrideFor } from '@/lib/tax/catalog'
import {
  addDays, tdsDepositDueDate, vatReturnPeriodFor, isPeriod,
} from '@/lib/finance/fiscal'
import { isValidObjectId } from '@/lib/objectId'

export const EPS = 0.005
const DAY_MS = 24 * 60 * 60 * 1000

export const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const str = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

export function httpError(status, message, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

/** Map a thrown error to a JSON response (Error.status < 500 ⇒ its message; else 500). */
export function errorResponse(err, tag) {
  const status = Number(err?.status)
  if (status >= 400 && status < 500) {
    const body = { error: err.message || 'Request failed' }
    if (err.code && typeof err.code === 'string') body.code = err.code
    if (err.field) body.field = err.field
    if (err.details) body.details = err.details
    return NextResponse.json(body, { status })
  }
  if (err?.name === 'ValidationError') {
    return NextResponse.json({ error: Object.values(err.errors ?? {}).map(e => e.message).join('; ') || 'Validation failed' }, { status: 422 })
  }
  // Safety net: a duplicate challan that reached the unique index (uniq_active_deposit_challan).
  if (err?.code === 11000 && (err.keyPattern?.challanKey || /uniq_active_deposit_challan/.test(String(err.message ?? '')))) {
    return NextResponse.json({ error: 'This challan number is already recorded' }, { status: 409 })
  }
  console.error(tag, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function escapeRegex(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Today's Dhaka day key 'YYYY-MM-DD'. */
export function todayKey() {
  return dhakaDayKey(new Date())
}

/** Whole days from `fromKey` to `toKey` ('YYYY-MM-DD'); positive when toKey is later. */
export function daysBetween(fromKey, toKey) {
  if (!fromKey || !toKey) return null
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS)
}

/** Dhaka day key of a Date / ISO value (null when invalid). */
export function dayKeyOfDate(d) {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : dhakaDayKey(t)
}

/** 'YYYY-MM-DD' validation that rejects overflow dates (2026-02-31). */
export function parseDay(value) {
  const s = String(value ?? '').trim()
  const parsed = parseDhakaDay(s)
  if (!parsed || dhakaDayKey(parsed.start) !== s) return null
  return { key: s, ...parsed }
}

/** Comma list of ObjectIds → unique array (throws 400 on an invalid id). */
export function parseIdList(value, { max = 500, field = 'ids' } = {}) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  if (ids.some(id => !isValidObjectId(id))) throw httpError(400, `Invalid id in ${field}`)
  if (ids.length > max) throw httpError(400, `Select at most ${max} entries`)
  return ids
}

export const toObjectIds = (ids) => ids.map(id => new mongoose.Types.ObjectId(String(id)))

/** Comma list of TaxEntry types (validated). */
export function parseEntryTypes(value) {
  if (!value) return []
  const list = String(value).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  const bad = list.filter(t => !TAX_ENTRY_TYPES.includes(t))
  if (bad.length) throw httpError(400, `Unknown entry type ${bad.join(', ')}`)
  return list
}

/** Stable key identifying the counter-party of an entry (same supplier / payee / customer). */
export function partyKeyOf(e) {
  if (e?.partyId) return `id:${String(e.partyId)}`
  const name = String(e?.partyName ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const bin = String(e?.partyBin ?? '').replace(/\D/g, '')
  return `name:${name}|${bin}`
}

function idOf(v) {
  if (v === null || v === undefined) return v
  if (v instanceof mongoose.Types.ObjectId) return String(v)
  return v
}

/** Populated sub-document → plain object with `id`. */
function plainRef(v) {
  if (!v || typeof v !== 'object' || v instanceof mongoose.Types.ObjectId || v instanceof Date) return idOf(v)
  const { _id, __v, ...rest } = v
  return { ...rest, id: _id ? String(_id) : rest.id ?? null }
}

/**
 * Lean TaxEntry (optionally populated) → API row: `id`, string ids, populated refs
 * as `{ id, ... }`, and `note` (Mushak-9.1 note) / deposit due date helpers added by callers.
 */
export function serializeEntry(doc) {
  if (!doc) return null
  const src = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const { _id, __v, ...rest } = src
  const out = { ...rest, id: _id ? String(_id) : (rest.id ?? null) }
  for (const k of ['invoiceId', 'creditNoteId', 'projectPaymentId', 'expenseId', 'transactionId', 'purchaseBillId', 'assetId', 'filingId', 'createdBy', 'voidedBy']) {
    if (k in out) out[k] = plainRef(out[k])
  }
  if (Array.isArray(out.settledEntryIds)) out.settledEntryIds = out.settledEntryIds.map(plainRef)
  if (Array.isArray(out.settledAllocations)) out.settledAllocations = out.settledAllocations.map(a => ({ ...a, entryId: idOf(a.entryId) }))
  if (out.deposit && typeof out.deposit === 'object') {
    out.deposit = { ...out.deposit, depositEntryId: plainRef(out.deposit.depositEntryId) }
    if (Array.isArray(out.deposit.allocations)) out.deposit.allocations = out.deposit.allocations.map(a => ({ ...a, depositEntryId: idOf(a.depositEntryId) }))
  }
  return out
}

// ── Part-paid TDS / VDS payables ────────────────────────────────────────────

/** Tax already deposited on a TDS / VDS payable: all of it once DEPOSITED, else its part payments. */
export function depositPaidOf(e) {
  const amount = round2(num(e?.amount))
  if (e?.deposit?.status === 'DEPOSITED') return amount
  return round2(Math.min(amount, Math.max(0, num(e?.deposit?.paidAmount))))
}

/** Tax still to be deposited by challan on a payable (0 unless deposit.status is PENDING). */
export function depositBalanceOf(e) {
  if (e?.deposit?.status !== 'PENDING') return 0
  return round2(Math.max(0, num(e?.amount) - num(e?.deposit?.paidAmount)))
}

/**
 * The challans that paid a payable: [{ depositEntryId, challanNo, date, accountCode, amount }].
 * Rows deposited in full before part payments existed have no allocations — their
 * one challan comes from deposit.* for the whole amount.
 */
export function depositAllocationsOf(e) {
  const list = Array.isArray(e?.deposit?.allocations) ? e.deposit.allocations : []
  const row = (a, amount) => ({
    depositEntryId: a?.depositEntryId ?? null, challanNo: a?.challanNo ?? null, date: a?.date ?? null,
    accountCode: a?.accountCode ?? null, amount: round2(num(amount)),
  })
  if (list.length) return list.map(a => row(a, a.amount))
  return e?.deposit?.status === 'DEPOSITED' ? [row(e.deposit, e.amount)] : []
}

/** TDS deposit due date and urgency for a TDS_PAYABLE (Rule 9). */
export function tdsDueInfo(entry, today = todayKey()) {
  const due = tdsDepositDueDate(entry?.date)
  if (!due) return { dueDate: null, daysLeft: null, overdue: false }
  const daysLeft = daysBetween(today, due)
  return { dueDate: due, daysLeft, overdue: due < today }
}

/** Unregistered VDS withholder: deposit within 15 days of paying the supplier (VDS Rules 2025). */
export function vdsDepositDueInfo(entry, today = todayKey()) {
  const key = dayKeyOfDate(entry?.date)
  const due = key ? addDays(key, 15) : null
  if (!due) return { dueDate: null, daysLeft: null, overdue: false }
  const daysLeft = daysBetween(today, due)
  return { dueDate: due, daysLeft, overdue: due < today }
}

/** VAT return period (with statutory overrides) that contains `period`. */
export function returnPeriodOf(period, frequency = 'MONTHLY') {
  if (!isPeriod(period)) return null
  return vatReturnOverrideFor(period) ?? vatReturnPeriodFor(period, frequency)
}

export function moneySum(rows, field = 'amount') {
  return round2((rows ?? []).reduce((s, r) => s + num(r?.[field]), 0))
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = value instanceof Date ? dhakaDayKey(value) : String(value)
  // Neutralise spreadsheet formula injection for text (not plain numbers).
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** columns: [{ label, value: (row) => any }] */
export function toCsv(columns, rows) {
  const lines = [columns.map(c => csvCell(c.label)).join(',')]
  for (const r of rows) lines.push(columns.map(c => csvCell(c.value(r))).join(','))
  return lines.join('\r\n')
}

export function csvResponse(csv, filename) {
  const safe = String(filename).replace(/[^\w.-]/g, '_')
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}"`,
    },
  })
}

/** Plain-number money for CSV / JSON (2 dp). */
export const money2 = (n) => round2(num(n))
