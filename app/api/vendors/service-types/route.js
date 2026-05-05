export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

const KEY = 'vendor_service_types'

export async function GET() {
  try {
    await connectDB()
    const setting = await Setting.findOne({ key: KEY }).lean()
    const types = setting?.value ? JSON.parse(setting.value) : []
    return NextResponse.json({ data: types })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const { types } = await request.json()
    if (!Array.isArray(types)) return NextResponse.json({ error: 'types must be an array' }, { status: 422 })

    const clean = types.map(t => t.trim()).filter(Boolean)
    await Setting.findOneAndUpdate(
      { key: KEY },
      { key: KEY, value: JSON.stringify(clean), group: 'vendors' },
      { upsert: true }
    )
    return NextResponse.json({ data: clean })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
