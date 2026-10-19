export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxFiling } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { filingView, maskReturnPii } from '@/app/api/tax/vat-return/_lib/server'
import { z } from 'zod'

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable()).optional()

// Only bookkeeping fields can change after filing — the figures are frozen
// (file an amended return to change them).
const updateSchema = z.object({
  acknowledgementNo: optText(80),
  attachmentUrl: z.preprocess(
    v => (empty(v) ? null : v),
    z.string().trim().max(500).regex(/^\/uploads\/[a-z]+\/[\w-]+\.[a-z0-9]+$/i, 'Upload the file first').nullable(),
  ).optional(),
  notes: optText(2000),
})

// GET /api/tax/filings/[id] → { data: filing incl. snapshot (the frozen return) }
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const filing = await TaxFiling.findById(params.id).populate({ path: 'filedBy', select: 'name' }).lean()
    if (!filing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data = filingView(filing, { withSnapshot: true })
    if (data.snapshot) maskReturnPii(session, data.snapshot)
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/tax/filings/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/tax/filings/[id]  { acknowledgementNo?, attachmentUrl?, notes? }
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.returns.file')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const parsed = updateSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const set = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
    if (!Object.keys(set).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    await connectDB()
    const before = await TaxFiling.findById(params.id).select('kind periodKey status acknowledgementNo attachmentUrl notes').lean()
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Mirror the acknowledgement number into the frozen snapshot so prints show it.
    const update = { $set: { ...set } }
    if (set.acknowledgementNo !== undefined && ['FILED', 'AMENDED'].includes(before.status)) {
      update.$set['snapshot.acknowledgementNo'] = set.acknowledgementNo
    }
    const filing = await TaxFiling.findByIdAndUpdate(params.id, update, { new: true })
      .populate({ path: 'filedBy', select: 'name' })
      .lean()
    if (!filing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const diff = {}
    for (const k of Object.keys(set)) {
      if ((before[k] ?? null) !== (filing[k] ?? null)) diff[k] = { from: before[k] ?? null, to: filing[k] ?? null }
    }
    if (Object.keys(diff).length) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UPDATE',
        entity:   'TAX_FILING',
        entityId: params.id,
        changes:  JSON.stringify({ kind: before.kind, periodKey: before.periodKey, ...diff }),
        request,
      })
    }

    return NextResponse.json({ data: filingView(filing) })
  } catch (err) {
    console.error('[PUT /api/tax/filings/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
