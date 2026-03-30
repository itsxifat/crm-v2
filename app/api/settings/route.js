export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

// GET /api/settings — returns all settings as { key: value }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const group = searchParams.get('group')

    const filter = group ? { group } : {}
    const settings = await Setting.find(filter).lean()

    const map = {}
    settings.forEach(s => { map[s.key] = s.value })

    return NextResponse.json({ data: map })
  } catch (err) {
    console.error('[GET /api/settings]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/settings — bulk upsert { key: value, ... }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()
    if (typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be an object of key-value pairs' }, { status: 422 })
    }

    const group   = body._group ?? 'general'
    const entries = Object.entries(body).filter(([k]) => k !== '_group')

    await Promise.all(
      entries.map(([key, value]) =>
        Setting.findOneAndUpdate(
          { key },
          { key, value: String(value), group },
          { upsert: true, new: true }
        )
      )
    )

    return NextResponse.json({ message: 'Settings saved', count: entries.length })
  } catch (err) {
    console.error('[POST /api/settings]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
