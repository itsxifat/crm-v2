export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MoneyAccount, Reconciliation, Transaction } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { getFinanceSettings, saveFinanceSettings } from '@/lib/finance/settings'
import { defaultAllowNegative } from '@/lib/finance/constants'
import { dayKeyLabel, isDayKey } from '@/lib/finance/fiscal'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { z } from 'zod'
import { loadOpeningData } from '../_lib/data'
import { plural, readFxRates, round2 } from '@/app/admin/finance/opening-balances/_lib/position'
import { httpError, errorResponse, isSuperAdmin } from '@/app/api/finance/periods/_lib/locks'

const blankToNull = (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v)

const rowSchema = z.object({
  id:               z.string().refine(isValidObjectId, 'Invalid account id'),
  openingBalance:   z.preprocess(blankToNull, z.coerce.number().finite('Enter a valid amount').min(-1e12).max(1e12).nullable()).optional(),
  openingDate:      z.preprocess(blankToNull, z.string().trim().refine(isDayKey, 'Use a valid date (YYYY-MM-DD)').nullable()).optional(),
  openingReference: z.preprocess(
    (v) => (v === undefined ? undefined : (v === null ? null : (String(v).trim() || null))),
    z.string().max(200, 'Reference is too long (max 200 characters)').nullable().optional(),
  ),
})

const schema = z.object({
  rows:    z.array(rowSchema).max(300, 'Too many accounts in one save').default([]),
  fxRates: z.record(z.string(), z.preprocess(blankToNull, z.coerce.number().finite().positive('Rate must be greater than 0').max(1e6).nullable())).optional(),
})

const dayOf = (d) => (d ? dhakaDayKey(d) : null)

// PUT /api/finance/opening-balances/money-accounts
// body { rows:[{ id, openingBalance, openingDate:'YYYY-MM-DD'|null, openingReference }], fxRates?: { USD: 121.5, EUR: null } }
// → { data: <same shape as GET /api/finance/opening-balances>, updated, warnings }
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.opening.manage')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const { rows, fxRates } = parsed.data
    if (!rows.length && !fxRates) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    const ids = rows.map(r => r.id)
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: 'Each account may appear only once' }, { status: 422 })
    }

    await connectDB()
    const settings = await getFinanceSettings()
    if (settings.openingLocked) throw httpError(409, 'Opening balances are locked — a super admin must unlock them first')

    const accounts = ids.length ? await MoneyAccount.find({ _id: { $in: ids } }) : []
    const byId = new Map(accounts.map(a => [String(a._id), a]))
    const missing = ids.filter(id => !byId.has(id))
    if (missing.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const today = dhakaDayKey(new Date())
    const lockedUntil = settings.lockedUntil
    const fieldErrors = {}
    const plans = []

    // Completed or in-progress reconciliations per account (the opening must not move
    // under a reconciled statement or under rows ticked in an open session) — same
    // rule as PUT /api/finance/accounts/[id].
    const recCounts = ids.length
      ? await Reconciliation.aggregate([
        { $match: { accountId: { $in: accounts.map(a => a._id) }, status: { $in: ['COMPLETED', 'IN_PROGRESS'] } } },
        { $group: { _id: '$accountId', count: { $sum: 1 } } },
      ])
      : []
    const recBy = new Map(recCounts.map(r => [String(r._id), r.count]))

    rows.forEach((row, i) => {
      const acc = byId.get(row.id)
      const before = {
        openingBalance:   round2(Number(acc.openingBalance) || 0),
        openingDate:      dayOf(acc.openingDate),
        openingReference: acc.openingReference ?? null,
      }
      const after = {
        openingBalance:   row.openingBalance === undefined || row.openingBalance === null ? before.openingBalance : round2(row.openingBalance),
        openingDate:      row.openingDate === undefined ? before.openingDate : row.openingDate,
        openingReference: row.openingReference === undefined ? before.openingReference : row.openingReference,
      }
      const balanceChanged = Math.abs(after.openingBalance - before.openingBalance) >= 0.005
      const dateChanged = after.openingDate !== before.openingDate
      const refChanged = after.openingReference !== before.openingReference
      if (!balanceChanged && !dateChanged && !refChanged) return

      if (after.openingDate && after.openingDate > today) {
        fieldErrors[`rows.${i}.openingDate`] = [`${acc.name}: the balance date cannot be in the future`]
        return
      }
      const allowNegative = acc.allowNegative ?? defaultAllowNegative(acc.type)
      if (after.openingBalance < 0 && !allowNegative) {
        fieldErrors[`rows.${i}.openingBalance`] = [`${acc.name}: a ${acc.type === 'MFS' ? 'wallet' : 'cash'} balance cannot be negative`]
        return
      }
      if (balanceChanged || dateChanged) {
        if (lockedUntil && (!before.openingDate || before.openingDate <= lockedUntil || !after.openingDate || after.openingDate <= lockedUntil)) {
          throw httpError(409, `Books are locked up to ${dayKeyLabel(lockedUntil)} — ${acc.name}'s opening balance falls in the locked period. Unlock the period first.`)
        }
        if (recBy.get(row.id)) {
          throw httpError(409, `${acc.name} has bank reconciliations (completed or in progress) — cancel or undo them before changing its opening balance or date`)
        }
      }
      plans.push({ acc, before, after, balanceChanged, dateChanged })
    })

    if (Object.keys(fieldErrors).length) {
      return NextResponse.json({ error: Object.values(fieldErrors)[0][0], details: { formErrors: [], fieldErrors } }, { status: 422 })
    }

    // FX rates (BDT per unit on go-live) — kept in finance settings.
    let fxPatch = null
    if (fxRates) {
      const currentRates = readFxRates(settings.openingFxRates)
      const next = {}
      for (const [rawCode, rate] of Object.entries(fxRates)) {
        const code = String(rawCode).trim().toUpperCase()
        if (!/^[A-Z]{3}$/.test(code) || code === 'BDT') {
          return NextResponse.json({ error: `Invalid currency code ${rawCode}`, details: { formErrors: [], fieldErrors: { [`fxRates.${rawCode}`]: ['Use a 3-letter currency code other than BDT'] } } }, { status: 422 })
        }
        next[code] = rate === null ? null : Math.round(rate * 1e6) / 1e6
      }
      const changed = Object.entries(next).filter(([c, r]) => (currentRates[c] ?? null) !== r)
      if (changed.length) fxPatch = { next, changed: changed.map(([c, r]) => ({ currency: c, from: currentRates[c] ?? null, to: r })) }
    }

    const warnings = []
    const updated = []
    for (const plan of plans) {
      const { acc, before, after } = plan
      acc.openingBalance = after.openingBalance
      acc.openingDate = after.openingDate ? parseDhakaDay(after.openingDate).start : null
      acc.openingReference = after.openingReference
      try {
        await acc.save()
      } catch (err) {
        if (err?.name === 'ValidationError') {
          const msg = Object.values(err.errors ?? {}).map(e => e.message).join('; ') || 'Invalid account data'
          throw httpError(422, `${acc.name}: ${msg}`)
        }
        throw err
      }
      updated.push(String(acc._id))

      if (after.openingDate && (!before.openingDate || after.openingDate > before.openingDate)) {
        const excluded = await Transaction.countDocuments({ accountId: acc._id, date: { $lt: parseDhakaDay(after.openingDate).start } })
        if (excluded) warnings.push(`${acc.name}: ${plural(excluded, 'entry', 'entries')} dated before ${dayKeyLabel(after.openingDate)} ${excluded === 1 ? 'is' : 'are'} now outside its balance.`)
      }
      if (settings.goLiveDate && after.openingDate && after.openingDate < settings.goLiveDate) {
        warnings.push(`${acc.name}: balance date is before go-live — entries between ${dayKeyLabel(after.openingDate)} and go-live count in its balance.`)
      }

      const diff = {}
      if (plan.balanceChanged) diff.openingBalance = { from: before.openingBalance, to: after.openingBalance }
      if (plan.dateChanged) diff.openingDate = { from: before.openingDate, to: after.openingDate }
      if (before.openingReference !== after.openingReference) diff.openingReference = { from: before.openingReference, to: after.openingReference }
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UPDATE',
        entity:   'OPENING_BALANCE',
        entityId: String(acc._id),
        changes:  JSON.stringify({ kind: 'MONEY_ACCOUNT', account: acc.name, currency: acc.currency, ...diff }),
        request,
      })
    }

    if (fxPatch) {
      await saveFinanceSettings({ openingFxRates: fxPatch.next })
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UPDATE',
        entity:   'OPENING_BALANCE',
        entityId: 'fx_rates',
        changes:  JSON.stringify({ kind: 'FX_RATES', changes: fxPatch.changed }),
        request,
      })
    }

    const data = await loadOpeningData(session)
    return NextResponse.json({
      data,
      meta: {
        canManage:      true,
        canUnlock:      isSuperAdmin(session),
        canLockPeriods: canDo(session, 'finance.periods.lock'),
      },
      updated,
      warnings,
    })
  } catch (err) {
    return errorResponse(err, '[PUT /api/finance/opening-balances/money-accounts]')
  }
}
