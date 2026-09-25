export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AuditLog } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { parseDhakaDay } from '@/lib/dhakaTime'

// GET /api/activity-logs
// Query params: userId, action, userRole, from, to, page (default 1), limit (default 25)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    // Same permission that gates the /admin/activity-logs page.
    const denied  = requirePerm(session, 'system.logs.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const userId   = searchParams.get('userId')
    const action   = searchParams.get('action')
    const userRole = searchParams.get('userRole')
    const from     = searchParams.get('from')
    const to       = searchParams.get('to')
    const page     = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10))
    const limit    = Math.min(100, parseInt(searchParams.get('limit') ?? '25', 10))
    const skip     = (page - 1) * limit

    const filter = {}
    if (userId)   filter.userId   = userId
    if (action)   filter.action   = action
    if (userRole) filter.userRole = userRole
    if (from || to) {
      // Bare 'YYYY-MM-DD' values are whole Asia/Dhaka calendar days, so the
      // selected end day is included in full.
      filter.createdAt = {}
      if (from) {
        const day = parseDhakaDay(from)
        filter.createdAt.$gte = day ? day.start : new Date(from)
      }
      if (to) {
        const day = parseDhakaDay(to)
        if (day) filter.createdAt.$lt  = day.next
        else     filter.createdAt.$lte = new Date(to)
      }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email avatar role')
        .lean(),
      AuditLog.countDocuments(filter),
    ])

    return NextResponse.json({
      data: logs.map(l => ({
        id:        l._id.toString(),
        action:    l.action,
        entity:    l.entity,
        entityId:  l.entityId,
        changes:   l.changes,
        ipAddress: l.ipAddress,
        userAgent: l.userAgent,
        createdAt: l.createdAt,
        userRole:  l.userRole,
        user: l.userId ? {
          id:     l.userId._id.toString(),
          name:   l.userId.name,
          email:  l.userId.email,
          avatar: l.userId.avatar ?? null,
          role:   l.userId.role,
        } : null,
      })),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/activity-logs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
