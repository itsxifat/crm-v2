export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'
import { canDo } from '@/lib/rbac'

// Credential blobs are only ever served (masked) by their dedicated endpoints.
const SECRET_KEYS = ['email_accounts', 'whatsapp_accounts']
// Keys owned by dedicated endpoints / the system — never writable through the
// generic bulk upsert (credentials merge masked values; gain_disabled seals bootstrap).
const RESERVED_KEYS = [...SECRET_KEYS, 'gain_disabled', 'crm_config']
// Groups any authenticated user (incl. client portal) may read — e.g. invoice letterhead.
const PUBLIC_GROUPS = ['company']

// GET /api/settings — returns all settings as { key: value }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const group = searchParams.get('group')

    if (session.user.role !== 'SUPER_ADMIN' && !PUBLIC_GROUPS.includes(group)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const filter = { ...(group ? { group } : {}), key: { $nin: SECRET_KEYS } }
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

    if (!canDo(session, 'system.config.update')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be an object of key-value pairs' }, { status: 422 })
    }

    const group   = body._group ?? 'general'
    const entries = Object.entries(body).filter(([k]) => k !== '_group')
    const reserved = entries.filter(([k]) => RESERVED_KEYS.includes(k)).map(([k]) => k)
    if (reserved.length) {
      return NextResponse.json({ error: `These settings cannot be written here: ${reserved.join(', ')}` }, { status: 403 })
    }

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
