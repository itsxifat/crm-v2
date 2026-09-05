export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CombinedInvoice } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { buildCombined, ensureCombinedInvoice, toObjectId } from '@/lib/combinedInvoice'

// GET /api/combined-invoices?clientId=&projectId=&page=&limit=
// Lists combined invoices with live rollups (totals/paid/due are never stored).
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.view')
    if (denied) return denied
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const clientId  = searchParams.get('clientId')
    const projectId = searchParams.get('projectId')

    const filter = {}
    if (clientId)  filter.clientId  = toObjectId(clientId)
    if (projectId) filter.projectId = toObjectId(projectId)

    const [docs, total] = await Promise.all([
      CombinedInvoice.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('projectId', 'name projectCode venture category')
        .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email avatar' } }),
      CombinedInvoice.countDocuments(filter),
    ])

    // Child line items aren't needed for a list; skip payments to keep it light.
    const data = await Promise.all(
      docs.map(async d => {
        const full = await buildCombined(d, { includePayments: false })
        return { ...full, children: full.children.map(({ items, ...rest }) => rest) }
      })
    )

    return NextResponse.json({
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/combined-invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/combined-invoices  { projectId, force? }
// Generates (or returns the existing) combined invoice for a project.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.create')
    if (denied) return denied
    await connectDB()

    const { projectId, force = true } = await request.json()
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 422 })

    const doc = await ensureCombinedInvoice(projectId, { createdBy: session.user.id, force })
    if (!doc) {
      return NextResponse.json(
        { error: 'This project has no invoices to combine yet.' },
        { status: 422 }
      )
    }

    await doc.populate([
      { path: 'projectId', select: 'name projectCode venture category' },
      { path: 'clientId',  populate: { path: 'userId', select: 'name email avatar' } },
    ])

    return NextResponse.json({ data: await buildCombined(doc) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/combined-invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
