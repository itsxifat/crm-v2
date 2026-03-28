export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AuditLog } from '@/models'

// GET /api/audit-logs
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit') ?? '50', 10)
    const userId    = searchParams.get('userId')
    const action    = searchParams.get('action')
    const entity    = searchParams.get('entity')
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const skip      = (page - 1) * limit

    const filter = {}
    if (userId) filter.userId = userId
    if (action) filter.action = { $regex: action, $options: 'i' }
    if (entity) filter.entity = entity
    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) filter.createdAt.$gte = new Date(startDate)
      if (endDate)   filter.createdAt.$lte = new Date(endDate)
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate({ path: 'userId', select: 'name email role' }),
      AuditLog.countDocuments(filter),
    ])

    return NextResponse.json({
      data: logs,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/audit-logs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
