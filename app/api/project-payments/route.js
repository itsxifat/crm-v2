export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectPayment } from '@/models'

// GET /api/project-payments?status=&page=&limit=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const status = searchParams.get('status')
    const skip   = (page - 1) * limit

    const filter = {}
    if (status) filter.status = status

    const [payments, total] = await Promise.all([
      ProjectPayment.find(filter)
        .skip(skip).limit(limit).sort({ createdAt: -1 })
        .populate({ path: 'projectId', select: 'name projectCode venture currency' })
        .populate({ path: 'invoiceId', select: 'invoiceNumber total paidAmount status' })
        .populate({ path: 'clientId',  populate: { path: 'userId', select: 'name email avatar' } })
        .populate('submittedBy', 'name avatar')
        .populate('confirmedBy', 'name'),
      ProjectPayment.countDocuments(filter),
    ])

    return NextResponse.json({
      data: payments.map(p => p.toJSON()),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/project-payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
