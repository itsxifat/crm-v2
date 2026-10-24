export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import {
  Setting, Project, ProjectExpense, Transaction, Invoice, Employee,
  EmployeeOnboarding, CustomRole, Lead, Quotation,
} from '@/models'
import { invalidateConfigCache } from '@/lib/getConfig'
import { canDo } from '@/lib/rbac'
import { ventureUnit, productUnit } from '@/lib/units'

const CONFIG_KEY = 'crm_config'

const DEFAULT_PAYMENT_METHODS = [
  { value: 'CASH',          label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CARD',          label: 'Card' },
  { value: 'CHEQUE',        label: 'Cheque' },
  { value: 'BKASH',         label: 'bKash' },
  { value: 'NAGAD',         label: 'Nagad' },
  { value: 'ROCKET',        label: 'Rocket' },
  { value: 'ONLINE',        label: 'Online Transfer' },
  { value: 'OTHER',         label: 'Other' },
]

const DEFAULT_CONFIG = {
  leadSources:           [],
  leadPlatforms:         [],
  leadCategories:        [],
  leadServices:          [],
  leadBusinessCategories:[],
  companyItemCategories: [],
  ventures:              [],
  // Business units that stand alone in finance (Envo, Ncom, …).
  // Shape: [{ id, label, description, active }] — ventures minus the prefix.
  products:              [],
  services:              {},
  // Transaction taxonomy — each category owns its subcategories. Admin-defined, no defaults.
  // Shape: [{ id, label, subcategories: string[] }]
  expenseCategories:     [],
  incomeCategories:      [],
  paymentMethods:        DEFAULT_PAYMENT_METHODS,
  verification: {
    freelancer:         true,
    clientKyc:          true,
    employeeOnboarding: true,
  },
}

// ── Ventures & products ──────────────────────────────────────────────────────
// Their ids end up on money records (unit 'VENTURE:<id>' / 'PRODUCT:<id>'), on
// projects and on employees, so an id is fixed once created and can only be
// removed while nothing uses it. Otherwise the entry is deactivated instead.

const UNIT_ID_RE     = /^[A-Z0-9]{1,12}$/
const PREFIX_RE      = /^[A-Z0-9]{1,4}$/
const RESERVED_IDS   = ['COMPANY', 'UNASSIGNED']
const LABEL_MAX      = 80
const DESCRIPTION_MAX = 300

const KINDS = {
  ventures: { noun: 'Venture', unit: ventureUnit },
  products: { noun: 'Product', unit: productUnit },
}

// A refusal the client should see as is (422 bad input, 409 still in use).
function invalid(message, status = 422) {
  const err = new Error(message)
  err.refusal = true
  err.status  = status
  return err
}

/**
 * Check and tidy one ventures / products list before it is stored.
 * Ids already stored are kept as they are (older ones may predate the format);
 * new ids must be A-Z0-9, up to 12 characters. Throws invalid().
 */
function normaliseUnitList(key, list, storedList) {
  const { noun } = KINDS[key]
  if (!Array.isArray(list)) throw invalid(`${key} must be a list`)
  const stored = new Map((Array.isArray(storedList) ? storedList : []).map(e => [e?.id, e]))

  return list.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalid(`${noun} ${i + 1} is not valid`)
    }
    const id    = typeof entry.id === 'string' ? entry.id.trim() : ''
    const old   = stored.get(id)
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    if (!id) throw invalid(`${noun} ${label ? `"${label}"` : i + 1} needs an ID`)
    if (!old) {
      if (!UNIT_ID_RE.test(id)) throw invalid(`${noun} ID "${id}" must be 1–12 capital letters or digits`)
      if (RESERVED_IDS.includes(id)) throw invalid(`${noun} ID "${id}" is reserved`)
    }
    if (!label) throw invalid(`${noun} ${id} needs a label`)
    if (label.length > LABEL_MAX) throw invalid(`${noun} ${id}: label is longer than ${LABEL_MAX} characters`)
    if (entry.description != null && typeof entry.description !== 'string') {
      throw invalid(`${noun} ${id}: description must be text`)
    }
    const description = (entry.description ?? '').trim()
    if (description.length > DESCRIPTION_MAX) {
      throw invalid(`${noun} ${id}: description is longer than ${DESCRIPTION_MAX} characters`)
    }
    if (entry.active != null && typeof entry.active !== 'boolean') {
      throw invalid(`${noun} ${id}: active must be true or false`)
    }
    const active = entry.active !== false

    if (key === 'products') return { id, label, description, active }

    // Ventures keep any other keys they carry. The prefix drives project codes:
    // a new or changed one must be 1–4 capital letters or digits.
    if (entry.prefix != null && typeof entry.prefix !== 'string') {
      throw invalid(`${noun} ${id}: prefix must be text`)
    }
    const prefix = (entry.prefix ?? '').trim().toUpperCase()
    if (prefix && prefix !== String(old?.prefix ?? '').trim().toUpperCase() && !PREFIX_RE.test(prefix)) {
      throw invalid(`${noun} ${id}: prefix must be 1–4 capital letters or digits`)
    }
    return { ...entry, id, label, prefix, description, active }
  })
}

const USAGE_NOUNS = {
  transaction: ['transaction', 'transactions'],
  invoice:     ['invoice', 'invoices'],
  expense:     ['expense', 'expenses'],
  project:     ['project', 'projects'],
  employee:    ['employee', 'employees'],
  onboarding:  ['employee onboarding', 'employee onboardings'],
  role:        ['custom role', 'custom roles'],
  lead:        ['lead', 'leads'],
  quotation:   ['quotation', 'quotations'],
}

/** What still names this venture / product: [{ noun, count }] with count > 0. */
async function unitUsage(key, id) {
  const unit   = KINDS[key].unit(id)
  const checks = [
    ['transaction', Transaction, { unit }],
    ['invoice',     Invoice,     { unit }],
    ['expense',     ProjectExpense, key === 'ventures' ? { $or: [{ unit }, { venture: id }] } : { unit }],
  ]
  if (key === 'ventures') {
    checks.push(
      ['project',    Project,            { venture: id }],
      ['employee',   Employee,           { venture: id }],
      ['onboarding', EmployeeOnboarding, { 'hrData.venture': id }],
      ['role',       CustomRole,         { venture: id }],
      ['lead',       Lead,               { service: id }],
      ['quotation',  Quotation,          { 'items.venture': id }],
    )
  }
  const counts = await Promise.all(checks.map(([, Model, filter]) => Model.countDocuments(filter)))
  return checks
    .map(([noun], i) => ({ noun, count: counts[i] }))
    .filter(u => u.count > 0)
}

function describeUsage(usage) {
  const parts = usage.map(({ noun, count }) => `${count} ${USAGE_NOUNS[noun][count === 1 ? 0 : 1]}`)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
}

/**
 * Validate the ventures / products lists of `next` against what is stored.
 * Only the keys in `keys` are checked (PATCH sends a subset). Ids must be
 * unique across both lists. Removing an id that records still use is refused
 * with 409. Returns `next` with the checked lists normalised.
 */
async function checkUnitLists(next, current, keys) {
  const out = { ...next }
  // A full replacement without the key clears the list; an explicit null is refused.
  for (const key of keys) out[key] = normaliseUnitList(key, next[key] === undefined ? [] : next[key], current[key])

  // One id per business unit, whatever its kind, so reports stay unambiguous.
  // A clash is reported only when a list being saved takes part in it.
  const seen = new Map() // upper-cased id → key of the first list holding it
  for (const key of ['ventures', 'products']) {
    for (const entry of Array.isArray(out[key]) ? out[key] : []) {
      const norm = String(entry?.id ?? '').toUpperCase()
      if (!norm) continue
      const first = seen.get(norm)
      if (!first) { seen.set(norm, key); continue }
      if (!keys.includes(key) && !keys.includes(first)) continue
      throw invalid(first === key
        ? `${KINDS[key].noun} ID "${entry.id}" is used twice`
        : `ID "${entry.id}" is used by both a venture and a product`)
    }
  }

  for (const key of keys) {
    const keptIds = new Set(out[key].map(e => e.id))
    const removed = (Array.isArray(current[key]) ? current[key] : []).filter(e => e?.id && !keptIds.has(e.id))
    for (const entry of removed) {
      const usage = await unitUsage(key, entry.id)
      if (usage.length) {
        throw invalid(
          `${KINDS[key].noun} "${entry.label ?? entry.id}" (${entry.id}) is still used by ${describeUsage(usage)}. Turn off Active instead of removing it.`,
          409,
        )
      }
    }
  }
  return out
}

function validationResponse(err) {
  return NextResponse.json({ error: err.message }, { status: err.status })
}

// GET /api/config
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const setting = await Setting.findOne({ key: CONFIG_KEY }).lean()
    if (!setting) {
      return NextResponse.json({ data: DEFAULT_CONFIG })
    }

    const saved  = JSON.parse(setting.value)
    const merged = {
      ...DEFAULT_CONFIG,
      ...saved,
      paymentMethods: saved.paymentMethods ?? DEFAULT_PAYMENT_METHODS,
      verification:   { ...DEFAULT_CONFIG.verification, ...(saved.verification ?? {}) },
    }
    return NextResponse.json({ data: merged })
  } catch (err) {
    console.error('[GET /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/config  — full replacement
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDo(session, 'system.config.update')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const raw = await request.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Body must be an object' }, { status: 422 })
    }
    const setting = await Setting.findOne({ key: CONFIG_KEY }).lean()
    const current = setting?.value ? JSON.parse(setting.value) : {}

    let body
    try {
      body = await checkUnitLists(raw, current, ['ventures', 'products'])
    } catch (err) {
      if (err.refusal) return validationResponse(err)
      throw err
    }

    await Setting.findOneAndUpdate(
      { key: CONFIG_KEY },
      { key: CONFIG_KEY, value: JSON.stringify(body), group: 'config' },
      { upsert: true, new: true }
    )
    invalidateConfigCache()

    return NextResponse.json({ data: body })
  } catch (err) {
    console.error('[PUT /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/config  — partial update, merges only the provided top-level keys
export async function PATCH(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDo(session, 'system.config.update')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const patch   = await request.json()
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return NextResponse.json({ error: 'Body must be an object' }, { status: 422 })
    }
    const setting = await Setting.findOne({ key: CONFIG_KEY }).lean()
    const current = setting?.value ? JSON.parse(setting.value) : {}

    let updated = {
      ...DEFAULT_CONFIG,
      ...current,
      ...patch,
      paymentMethods: patch.paymentMethods ?? current.paymentMethods ?? DEFAULT_PAYMENT_METHODS,
      verification:   { ...DEFAULT_CONFIG.verification, ...(current.verification ?? {}), ...(patch.verification ?? {}) },
    }

    // Only the lists this request sends are checked, so an unrelated save
    // (verification, payment methods…) never trips over older entries.
    const unitKeys = ['ventures', 'products'].filter(k => Object.prototype.hasOwnProperty.call(patch, k))
    if (unitKeys.length) {
      try {
        updated = await checkUnitLists(updated, current, unitKeys)
      } catch (err) {
        if (err.refusal) return validationResponse(err)
        throw err
      }
    }

    await Setting.findOneAndUpdate(
      { key: CONFIG_KEY },
      { key: CONFIG_KEY, value: JSON.stringify(updated), group: 'config' },
      { upsert: true, new: true }
    )
    invalidateConfigCache()

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PATCH /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
