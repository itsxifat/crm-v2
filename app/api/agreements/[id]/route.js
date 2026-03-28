import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Agreement } from '@/models'

// GET /api/agreements/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const agreement = await Agreement.findById(params.id)
      .populate({ path: 'clientId',     populate: { path: 'userId', select: 'name email' } })
      .populate({ path: 'freelancerId', populate: { path: 'userId', select: 'name email' } })
      .populate({ path: 'vendorId', select: 'id company email' })

    if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: agreement })
  } catch (err) {
    console.error('[GET /api/agreements/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/agreements/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()
    const { expiryDate, signedAt, ...rest } = body

    const agreement = await Agreement.findByIdAndUpdate(
      params.id,
      {
        ...rest,
        ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
        ...(signedAt   !== undefined && { signedAt:   signedAt   ? new Date(signedAt)   : null }),
      },
      { new: true }
    )

    return NextResponse.json({ data: agreement })
  } catch (err) {
    console.error('[PUT /api/agreements/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/agreements/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    await Agreement.findByIdAndDelete(params.id)
    return NextResponse.json({ message: 'Agreement deleted' })
  } catch (err) {
    console.error('[DELETE /api/agreements/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
