export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import mongoose from 'mongoose'
import { requireStaff, requirePerm } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import { Project } from '@/models'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session) ?? requirePerm(session, 'projects.view')
    if (denied) return denied
    await connectDB()

    // Employees only count the projects they can see in /api/projects
    // (aggregate() doesn't cast, so use a real ObjectId).
    const scope = {}
    if (session.user.role === 'EMPLOYEE') {
      if (mongoose.Types.ObjectId.isValid(session.user.id)) {
        const uid = new mongoose.Types.ObjectId(session.user.id)
        scope.$or = [{ projectManagerId: uid }, { teamMembers: uid }]
      } else {
        scope._id = null
      }
    }

    const [statusCounts, total, missedDeadline] = await Promise.all([
      Project.aggregate([
        { $match: scope },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Project.countDocuments(scope),
      Project.countDocuments({
        ...scope,
        projectType: 'FIXED',
        deadline: { $lt: new Date() },
        status: { $nin: ['DELIVERED', 'CANCELLED', 'APPROVED'] },
      }),
    ])

    const byStatus = {}
    for (const { _id, count } of statusCounts) byStatus[_id] = count

    return NextResponse.json({
      data: {
        total,
        missedDeadline,
        byStatus,
        // Grouped summaries
        active:      (byStatus.IN_PROGRESS ?? 0) + (byStatus.ACTIVE ?? 0),
        notStarted:  byStatus.PENDING ?? 0,
        inReview:    (byStatus.IN_REVIEW ?? 0) + (byStatus.REVISION ?? 0),
        onHold:      byStatus.ON_HOLD ?? 0,
        cancelled:   byStatus.CANCELLED ?? 0,
        delivered:   (byStatus.DELIVERED ?? 0) + (byStatus.APPROVED ?? 0),
        expiringSoon: byStatus.EXPIRING_SOON ?? 0,
      }
    })
  } catch (err) {
    console.error('[GET /api/projects/stats]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
