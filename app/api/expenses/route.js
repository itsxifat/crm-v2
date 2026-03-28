import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense, Project } from '@/models'

// GET /api/expenses?status=PENDING&venture=&page=&limit=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page    = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit   = parseInt(searchParams.get('limit') ?? '20', 10)
    const status  = searchParams.get('status')
    const venture = searchParams.get('venture')
    const skip    = (page - 1) * limit

    const filter = {}
    if (status)  filter.status  = status
    if (venture) filter.venture = venture

    const [expenses, total] = await Promise.all([
      ProjectExpense.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit)
        .populate('submittedBy', 'name avatar email')
        .populate('reviewedBy', 'name')
        .populate({ path: 'projectId', select: 'name venture clientId', populate: { path: 'clientId', populate: { path: 'userId', select: 'name' } } }),
      ProjectExpense.countDocuments(filter),
    ])

    return NextResponse.json({
      data: expenses.map(e => e.toJSON()),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
