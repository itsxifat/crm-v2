import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project } from '@/models'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const [statusCounts, total, missedDeadline] = await Promise.all([
      Project.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Project.countDocuments(),
      Project.countDocuments({
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
