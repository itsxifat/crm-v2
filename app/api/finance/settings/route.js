export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry } from '@/models'
import { canDo } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { DEFAULT_FINANCE_SETTINGS, getFinanceSettings, saveFinanceSettings } from '@/lib/finance/settings'
import { dayKeyLabel, isDayKey } from '@/lib/finance/fiscal'
import { parseDhakaDay } from '@/lib/dhakaTime'
import { plural } from '@/app/admin/finance/opening-balances/_lib/position'
import {
  requireAny, httpError, errorResponse, checkLockChange, describeLockChange, cleanReason,
} from '@/app/api/finance/periods/_lib/locks'

// Anyone who works with money accounts, tax, inventory or opening balances may
// read the finance settings (fiscal year, go-live, locks, tax & inventory policy).
const READ_PERMISSIONS = [
  'finance.accounts.view', 'tax.view', 'inventory.view', 'inventory.manage', 'finance.opening.manage', 'finance.periods.lock',
]

// Top-level keys a PUT may carry and the permission each needs.
const SECTION_PERMS = {
  fiscalYearStartMonth: { perm: 'finance.opening.manage', label: 'the fiscal year' },
  goLiveDate:           { perm: 'finance.opening.manage', label: 'the go-live date' },
  vat:                  { perm: 'tax.manage',             label: 'VAT settings' },
  incomeTax:            { perm: 'tax.manage',             label: 'income-tax settings' },
  inventory:            { perm: 'inventory.manage',       label: 'inventory policy' },
  lockedUntil:          { perm: 'finance.periods.lock',   label: 'the books lock' },
  taxLockedUntil:       { perm: 'finance.periods.lock',   label: 'the tax lock' },
}
const MANAGED_ELSEWHERE = ['openingLocked', 'openingLockedAt', 'openingLockedBy', 'openingFxRates']

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Flatten { a: { b: 1 } } → { 'a.b': 1 } (arrays/null are leaves). */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (isPlainObject(v)) flatten(v, key, out)
    else out[key] = v
  }
  return out
}

function diffSettings(before, after, keys) {
  const a = flatten(before)
  const b = flatten(after)
  const changes = []
  for (const key of Object.keys(b)) {
    if (!keys.some(k => key === k || key.startsWith(`${k}.`))) continue
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) changes.push({ key, from: a[key] ?? null, to: b[key] ?? null })
  }
  return changes
}

function editableSections(session) {
  return Object.fromEntries(Object.entries(SECTION_PERMS).map(([k, v]) => [k, canDo(session, v.perm)]))
}

// GET /api/finance/settings — merged finance settings (+ which sections the caller may edit)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAny(session, READ_PERMISSIONS)
    if (denied) return denied

    await connectDB()
    const settings = await getFinanceSettings()
    return NextResponse.json({ data: settings, meta: { canEdit: editableSections(session) } })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/settings]')
  }
}

// PUT /api/finance/settings — partial patch, permission-checked per section.
//   { fiscalYearStartMonth?, goLiveDate?, vat?:{…}, incomeTax?:{…}, inventory?:{…},
//     lockedUntil?, taxLockedUntil?, reason? }
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    const denied = requireAny(session, Object.values(SECTION_PERMS).map(s => s.perm))
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!isPlainObject(body)) return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    const { reason, ...patch } = body

    // Shape checks: known keys only, groups must be objects with known sub-keys.
    const fieldErrors = {}
    for (const key of Object.keys(patch)) {
      if (MANAGED_ELSEWHERE.includes(key)) {
        fieldErrors[key] = [key === 'openingFxRates'
          ? 'Exchange rates are saved with the money-account opening balances'
          : 'Use the opening-balance lock to change this']
        continue
      }
      if (!SECTION_PERMS[key]) { fieldErrors[key] = ['Unknown setting']; continue }
      if (['vat', 'incomeTax', 'inventory'].includes(key)) {
        if (!isPlainObject(patch[key])) { fieldErrors[key] = ['Must be an object']; continue }
        const allowed = Object.keys(DEFAULT_FINANCE_SETTINGS[key])
        for (const sub of Object.keys(patch[key])) {
          if (!allowed.includes(sub)) fieldErrors[`${key}.${sub}`] = ['Unknown setting']
        }
      }
    }
    if (patch.goLiveDate !== undefined && patch.goLiveDate !== null && patch.goLiveDate !== '' && !isDayKey(patch.goLiveDate)) {
      fieldErrors.goLiveDate = ['Use a valid date (YYYY-MM-DD)']
    }
    if (Object.keys(fieldErrors).length) {
      return NextResponse.json({ error: 'Validation failed', details: { formErrors: [], fieldErrors } }, { status: 422 })
    }
    const keys = Object.keys(patch)
    if (!keys.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    // Per-section permissions.
    for (const key of keys) {
      const { perm, label } = SECTION_PERMS[key]
      if (!canDo(session, perm)) {
        return NextResponse.json({ error: `You don't have permission to change ${label}` }, { status: 403 })
      }
    }

    await connectDB()
    const current = await getFinanceSettings()
    const warnings = []

    // Go-live / fiscal year: frozen once opening balances are locked.
    const goLiveChanging = patch.goLiveDate !== undefined && (patch.goLiveDate || null) !== (current.goLiveDate || null)
    const fyChanging = patch.fiscalYearStartMonth !== undefined && Number(patch.fiscalYearStartMonth) !== Number(current.fiscalYearStartMonth)
    if ((goLiveChanging || fyChanging) && current.openingLocked) {
      throw httpError(409, 'Opening balances are locked — unlock them before changing the go-live date or fiscal year')
    }
    if (goLiveChanging) {
      const next = patch.goLiveDate || null
      const openingCount = await TaxEntry.countDocuments({ isOpening: true, status: 'ACTIVE' })
      if (!next && openingCount) {
        throw httpError(409, `There ${openingCount === 1 ? 'is' : 'are'} ${plural(openingCount, 'opening tax balance')} — void them before clearing the go-live date`)
      }
      if (next) {
        const conflicts = await TaxEntry.countDocuments({ isOpening: true, status: 'ACTIVE', date: { $gte: parseDhakaDay(next).start } })
        if (conflicts) {
          throw httpError(409, `${plural(conflicts, 'opening tax balance')} dated on or after ${dayKeyLabel(next)} — opening balances must be dated before go-live. Edit or void them first.`)
        }
        warnings.push('Check the balance date of each money account — it should normally be the new go-live date.')
      }
    }
    if (fyChanging) {
      warnings.push('Tax entries already recorded keep the fiscal year they were saved with.')
    }

    // Locks: same rules as /api/finance/periods.
    const lockChanges = []
    for (const field of ['lockedUntil', 'taxLockedUntil']) {
      if (patch[field] === undefined) continue
      const change = checkLockChange({ field, current: current[field], next: patch[field], reason, session })
      if (change.unchanged) { delete patch[field]; continue }
      patch[field] = change.to
      lockChanges.push(change)
    }
    const why = cleanReason(reason)

    if (!Object.keys(patch).length) {
      return NextResponse.json({ data: current, meta: { canEdit: editableSections(session), unchanged: true }, warnings })
    }

    const saved = await saveFinanceSettings(patch)
    const changes = diffSettings(current, saved, Object.keys(patch))

    const nonLockChanges = changes.filter(c => !['lockedUntil', 'taxLockedUntil'].includes(c.key))
    if (nonLockChanges.length) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UPDATE',
        entity:   'FINANCE_SETTINGS',
        entityId: 'finance_settings',
        changes:  JSON.stringify({ changes: nonLockChanges, ...(why ? { reason: why } : {}) }),
        request,
      })
    }
    for (const lc of lockChanges) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   lc.action,
        entity:   'FINANCE_SETTINGS',
        entityId: lc.field,
        changes:  JSON.stringify({ field: lc.field, from: lc.from, to: lc.to, summary: describeLockChange(lc), ...(lc.reason ? { reason: lc.reason } : {}) }),
        request,
      })
    }

    return NextResponse.json({ data: saved, meta: { canEdit: editableSections(session) }, changes, warnings })
  } catch (err) {
    return errorResponse(err, '[PUT /api/finance/settings]')
  }
}
