import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer } from '@/models'

// GET /api/freelancers/profile — returns current freelancer's own profile (FREELANCER role only)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'FREELANCER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const freelancer = await Freelancer.findOne({ userId: session.user.id })
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })
      .select('-pricing')
      .lean()

    if (!freelancer) return NextResponse.json({ error: 'Freelancer profile not found' }, { status: 404 })

    // Ensure id is serialised
    const data = {
      ...freelancer,
      id: freelancer._id.toString(),
    }
    delete data._id
    delete data.__v

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/freelancers/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
