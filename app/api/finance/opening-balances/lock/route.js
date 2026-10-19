export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, canDo } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { saveFinanceSettings } from '@/lib/finance/settings'
import { z } from 'zod'
import { loadOpeningData } from '../_lib/data'
import {
  httpError, errorResponse, isSuperAdmin, UNLOCK_REASON_MIN, REASON_MAX,
} from '@/app/api/finance/periods/_lib/locks'

const schema = z.object({
  action: z.enum(['lock', 'unlock'], { errorMap: () => ({ message: "action must be 'lock' or 'unlock'" }) }),
  reason: z.preprocess(
    (v) => (v === undefined || v === null ? '' : String(v).trim()),
    z.string().max(REASON_MAX, `Reason is too long (max ${REASON_MAX} characters)`),
  ),
})

// POST /api/finance/opening-balances/lock — { action: 'lock'|'unlock', reason }
// lock: finance.opening.manage, go-live date required. unlock: SUPER_ADMIN only, reason ≥ 10 characters.
// → { data: <same shape as GET /api/finance/opening-balances>, meta, warnings }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.opening.manage')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const { action, reason } = parsed.data

    const current = await loadOpeningData(session)
    const warnings = []

    if (action === 'lock') {
      if (current.openingLocked) throw httpError(409, 'Opening balances are already locked')
      const blocking = current.checks.filter(c => c.level === 'error')
      if (blocking.length) throw httpError(422, blocking[0].message)
      for (const c of current.checks.filter(c => c.level === 'warning')) warnings.push(c.message)

      await saveFinanceSettings({
        openingLocked:   true,
        openingLockedAt: new Date().toISOString(),
        openingLockedBy: session.user.id,
      })

      const { position } = current
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'LOCK',
        entity:   'OPENING_BALANCE',
        entityId: 'opening_balances',
        changes:  JSON.stringify({
          goLiveDate:  current.goLiveDate,
          asOfDate:    current.asOfDate,
          assets:      position.assets.total,
          liabilities: position.liabilities.total,
          equity:      position.equity,
          warnings:    warnings.length,
          ...(reason ? { reason } : {}),
        }),
        request,
      })
    } else {
      if (!current.openingLocked) throw httpError(409, 'Opening balances are not locked')
      if (!isSuperAdmin(session)) throw httpError(403, 'Only a super admin can unlock opening balances')
      if (reason.length < UNLOCK_REASON_MIN) {
        return NextResponse.json({
          error: `Give a reason of at least ${UNLOCK_REASON_MIN} characters for unlocking`,
          details: { formErrors: [], fieldErrors: { reason: [`At least ${UNLOCK_REASON_MIN} characters`] } },
        }, { status: 422 })
      }

      await saveFinanceSettings({ openingLocked: false, openingLockedAt: null, openingLockedBy: null })

      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UNLOCK',
        entity:   'OPENING_BALANCE',
        entityId: 'opening_balances',
        changes:  JSON.stringify({
          reason,
          lockedAt: current.openingLockedAt,
          lockedBy: current.openingLockedBy?.name ?? current.openingLockedBy?.id ?? null,
          equity:   current.position.equity,
        }),
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
      warnings,
    })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/opening-balances/lock]')
  }
}
