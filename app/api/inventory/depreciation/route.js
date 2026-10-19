export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { z } from 'zod'
import { getFinanceSettings } from '@/lib/finance/settings'
import { previewDepreciation, runDepreciation, depreciationStatus, isValidPeriod, comparePeriods } from '@/lib/inventory/depreciation'
import { errorResponse } from '../reports/_lib/common'
import { listRuns, serializeRunWithNames, reverseDepreciationRun } from './_lib/runs'

const VIEW_PERMS = ['inventory.view', 'inventory.manage', 'inventory.depreciation.run']

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM')
const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('run'), period: periodSchema, notes: z.string().trim().max(500).optional().nullable() }),
  z.object({ action: z.literal('reverse'), period: periodSchema, reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }),
])

/** The month the dashboard should offer: the next unposted month, never beyond the current one. */
function defaultPeriod(status) {
  if (!status?.nextPeriod) return status?.previousPeriod
  return comparePeriods(status.nextPeriod, status.currentPeriod) > 0 ? status.currentPeriod : status.nextPeriod
}

// GET /api/inventory/depreciation?period=YYYY-MM&lines=0
// → { data: { status, period, preview, runs, settings } }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const requested = searchParams.get('period')
    if (requested && !isValidPeriod(requested)) return NextResponse.json({ error: 'Period must be YYYY-MM' }, { status: 422 })
    const withLines = searchParams.get('lines') !== '0'

    await connectDB()
    const [status, settings, runs] = await Promise.all([depreciationStatus(), getFinanceSettings(), listRuns()])
    const period = requested || defaultPeriod(status)
    const preview = await previewDepreciation(period)

    return NextResponse.json({
      data: {
        status,
        period,
        preview: withLines ? preview : { ...preview, lines: undefined },
        runs,
        settings: {
          convention: settings.inventory?.depreciationConvention ?? 'PRORATA_DAYS',
          postToLedger: settings.inventory?.postDepreciationToLedger !== false,
          lockedUntil: settings.lockedUntil ?? null,
          goLiveDate: settings.goLiveDate ?? null,
        },
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/depreciation]')
  }
}

// POST /api/inventory/depreciation
//   { action: 'run', period, notes? }      → post the month (201 { data: run })
//   { action: 'reverse', period, reason }  → reverse the latest posted run
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.depreciation.run')
    if (denied) return denied

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = postSchema.safeParse({ action: 'run', ...(body ?? {}) })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const input = parsed.data

    await connectDB()

    if (input.action === 'reverse') {
      const out = await reverseDepreciationRun(input.period, { reason: input.reason, session })
      logActivity({
        userId: session.user.id,
        userRole: session.user.role,
        action: 'VOID',
        entity: 'DEPRECIATION',
        entityId: out.run?.id ?? null,
        changes: JSON.stringify({ period: input.period, amount: out.amount, assets: out.assetCount, reason: input.reason, reversalTransactionId: out.reversalTransactionId }),
        request,
      })
      return NextResponse.json({ data: out })
    }

    const run = await runDepreciation(input.period, { userId: session.user.id, session, notes: input.notes || null })
    const data = await serializeRunWithNames(run)
    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'DEPRECIATE',
      entity: 'DEPRECIATION',
      entityId: data.id,
      changes: JSON.stringify({ period: data.period, totalAmount: data.totalAmount, assetCount: data.assetCount, transactionId: data.transactionId }),
      request,
    })
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/depreciation]')
  }
}
