export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AuditLog, TaxFiling, User } from '@/models'
import { canDo } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { getFinanceSettings, saveFinanceSettings } from '@/lib/finance/settings'
import { addDays, dayKeyLabel, periodLastDay, taxPeriodOf, addPeriods } from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'
import {
  FINANCE_AUDIT_ENTITIES, requireAny, isSuperAdmin, errorResponse, checkLockChange, describeLockChange,
} from './_lib/locks'

const VIEW_PERMISSIONS = ['finance.periods.lock', 'finance.opening.manage']
const HISTORY_SCOPES = {
  locks: { action: { $in: ['LOCK', 'UNLOCK'] } },
  all:   {},
}

function parseChanges(raw) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return { text: String(raw) } }
}

async function loadHistory({ scope = 'all', page = 1, limit = 30 } = {}) {
  const filter = { entity: { $in: FINANCE_AUDIT_ENTITIES }, ...(HISTORY_SCOPES[scope] ?? {}) }
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('userId', 'name').lean(),
    AuditLog.countDocuments(filter),
  ])
  return {
    data: rows.map(r => ({
      id:        String(r._id),
      at:        r.createdAt,
      action:    r.action,
      entity:    r.entity,
      entityId:  r.entityId ?? null,
      user:      r.userId && typeof r.userId === 'object' ? { id: String(r.userId._id), name: r.userId.name ?? null } : null,
      userRole:  r.userRole ?? null,
      changes:   parseChanges(r.changes),
    })),
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  }
}

async function periodState(session) {
  const settings = await getFinanceSettings()
  const [lockedBy, filings] = await Promise.all([
    settings.openingLockedBy && /^[a-f0-9]{24}$/i.test(settings.openingLockedBy)
      ? User.findById(settings.openingLockedBy).select('name').lean()
      : Promise.resolve(null),
    TaxFiling.find({ kind: 'VAT_RETURN', status: { $in: ['FILED', 'AMENDED'] } })
      .sort({ periodEnd: -1, filedAt: -1 }).limit(6)
      .select('periodKey periodStart periodEnd status returnType filedAt acknowledgementNo')
      .lean(),
  ])
  const today = dhakaDayKey(new Date())
  const lastMonthEnd = periodLastDay(addPeriods(taxPeriodOf(new Date()), -1))
  return {
    lockedUntil:     settings.lockedUntil,
    taxLockedUntil:  settings.taxLockedUntil,
    goLiveDate:      settings.goLiveDate,
    asOfDate:        settings.goLiveDate ? addDays(settings.goLiveDate, -1) : null,
    openingLocked:   !!settings.openingLocked,
    openingLockedAt: settings.openingLockedAt ?? null,
    openingLockedBy: lockedBy ? { id: String(lockedBy._id), name: lockedBy.name } : null,
    today,
    suggestedLockDate: lastMonthEnd,
    recentVatFilings: filings.map(f => ({
      id:                String(f._id),
      periodKey:         f.periodKey,
      periodEnd:         f.periodEnd ? periodLastDay(f.periodEnd) : null,
      status:            f.status,
      returnType:        f.returnType,
      filedAt:           f.filedAt ?? null,
      acknowledgementNo: f.acknowledgementNo ?? null,
    })),
    permissions: {
      canLock:   canDo(session, 'finance.periods.lock'),
      canUnlock: canDo(session, 'finance.periods.lock') && isSuperAdmin(session),
      canManageOpening: canDo(session, 'finance.opening.manage'),
      canUnlockOpening: canDo(session, 'finance.opening.manage') && isSuperAdmin(session),
    },
  }
}

// GET /api/finance/periods?scope=all|locks&page=&limit= — current locks + audit trail
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAny(session, VIEW_PERMISSIONS)
    if (denied) return denied

    await connectDB()
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') === 'locks' ? 'locks' : 'all'
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10) || 30))

    const [state, history] = await Promise.all([periodState(session), loadHistory({ scope, page, limit })])
    return NextResponse.json({ data: { ...state, history: history.data }, meta: history.meta })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/periods]')
  }
}

// POST /api/finance/periods — { lockedUntil?: 'YYYY-MM-DD'|null, taxLockedUntil?: 'YYYY-MM-DD'|null, reason }
// Moving a date forward locks more days (finance.periods.lock). Moving it back or
// clearing it unlocks days: SUPER_ADMIN only, with a reason of 10+ characters.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAny(session, ['finance.periods.lock'])
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }
    const fields = ['lockedUntil', 'taxLockedUntil'].filter(f => body[f] !== undefined)
    if (!fields.length) {
      return NextResponse.json({ error: 'Validation failed', details: { formErrors: ['Send lockedUntil and/or taxLockedUntil'], fieldErrors: {} } }, { status: 422 })
    }

    await connectDB()
    const current = await getFinanceSettings()
    const changes = fields
      .map(field => checkLockChange({ field, current: current[field], next: body[field], reason: body.reason, session }))
      .filter(c => !c.unchanged)

    if (!changes.length) {
      const state = await periodState(session)
      return NextResponse.json({ data: state, unchanged: true, warnings: [] })
    }

    const patch = Object.fromEntries(changes.map(c => [c.field, c.to]))
    const saved = await saveFinanceSettings(patch)

    for (const c of changes) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   c.action,
        entity:   'FINANCE_SETTINGS',
        entityId: c.field,
        changes:  JSON.stringify({ field: c.field, from: c.from, to: c.to, summary: describeLockChange(c), ...(c.reason ? { reason: c.reason } : {}) }),
        request,
      })
    }

    const warnings = []
    const books = changes.find(c => c.field === 'lockedUntil' && c.action === 'LOCK')
    if (books && saved.goLiveDate && !saved.openingLocked && books.to >= addDays(saved.goLiveDate, -1)) {
      warnings.push('Opening balances are still open — review and lock them on the Opening balances page.')
    }
    const tax = changes.find(c => c.field === 'taxLockedUntil' && c.action === 'UNLOCK')
    if (tax) {
      warnings.push(`VAT entries dated up to ${tax.from ? dayKeyLabel(tax.from) : '—'} can be changed again. Re-file (amend) the return if its figures change.`)
    }

    const state = await periodState(session)
    return NextResponse.json({ data: state, changes: changes.map(c => ({ field: c.field, from: c.from, to: c.to, action: c.action })), warnings })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/periods]')
  }
}
