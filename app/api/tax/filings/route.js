export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxFiling } from '@/models'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { TAX_FILING_KINDS } from '@/lib/tax/catalog'
import { filingView } from '@/app/api/tax/vat-return/_lib/server'

const STATUSES = ['DRAFT', 'FILED', 'AMENDED']

// GET /api/tax/filings?kind=VAT_RETURN|WHT_RETURN|ADVANCE_TAX|INCOME_TAX_RETURN&status=FILED,AMENDED&fiscalYear=2026-27&page=1&limit=50
//   → { data: [filing summary (no snapshot)], meta }  newest period first
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') || null
    if (kind && !TAX_FILING_KINDS.includes(kind)) {
      return NextResponse.json({ error: `kind must be one of ${TAX_FILING_KINDS.join(', ')}` }, { status: 400 })
    }
    const statusParam = searchParams.get('status')
    const statuses = statusParam ? statusParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : []
    if (statuses.some(s => !STATUSES.includes(s))) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 })
    }
    const fiscalYear = searchParams.get('fiscalYear')
    if (fiscalYear && !/^\d{4}(-\d{2})?$/.test(fiscalYear)) {
      return NextResponse.json({ error: 'fiscalYear must look like 2026-27' }, { status: 400 })
    }
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50))

    const filter = {}
    if (kind) filter.kind = kind
    if (statuses.length) filter.status = { $in: statuses }
    if (fiscalYear) filter.fiscalYear = fiscalYear

    await connectDB()
    const [rows, total] = await Promise.all([
      TaxFiling.find(filter)
        // Keep the history length for the list without shipping the frozen returns.
        .select({ snapshot: 0 })
        .populate({ path: 'filedBy', select: 'name' })
        .sort({ periodEnd: -1, periodKey: -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TaxFiling.countDocuments(filter),
    ])

    // History counts without loading snapshots.
    const ids = rows.map(r => r._id)
    const counts = ids.length
      ? await TaxFiling.aggregate([
          { $match: { _id: { $in: ids } } },
          { $project: { n: { $size: { $ifNull: ['$snapshot.history', []] } } } },
        ])
      : []
    const countById = new Map(counts.map(c => [String(c._id), c.n]))

    return NextResponse.json({
      data: rows.map(r => ({ ...filingView(r), historyCount: countById.get(String(r._id)) ?? 0 })),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/tax/filings]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
