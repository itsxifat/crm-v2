export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

// GET /api/settings/[key]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const setting = await Setting.findOne({ key: params.key }).lean()
    if (!setting) return NextResponse.json({ error: 'Setting not found' }, { status: 404 })

    return NextResponse.json({ data: setting })
  } catch (err) {
    console.error('[GET /api/settings/[key]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/settings/[key]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body  = await request.json()
    const value = body.value
    if (value === undefined) {
      return NextResponse.json({ error: 'value is required' }, { status: 422 })
    }

    const setting = await Setting.findOneAndUpdate(
      { key: params.key },
      { key: params.key, value: String(value), group: body.group ?? 'general' },
      { upsert: true, new: true }
    )

    return NextResponse.json({ data: setting })
  } catch (err) {
    console.error('[PUT /api/settings/[key]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
