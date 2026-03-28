import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

const KEY = 'email_accounts'

// GET /api/settings/email
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    const setting = await Setting.findOne({ key: KEY }).lean()
    const accounts = setting ? JSON.parse(setting.value) : []

    // Mask passwords in response
    const masked = accounts.map(a => ({ ...a, password: a.password ? '••••••••' : '' }))
    return NextResponse.json({ data: masked })
  } catch (err) {
    console.error('[GET /api/settings/email]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/settings/email  — full replace
// Body: array of account objects. If password is '••••••••', keep existing.
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const incoming = await request.json()
    if (!Array.isArray(incoming)) {
      return NextResponse.json({ error: 'Expected array' }, { status: 400 })
    }

    // Load existing so we can preserve masked passwords
    const existing = await Setting.findOne({ key: KEY }).lean()
    const existingAccounts = existing ? JSON.parse(existing.value) : []

    const merged = incoming.map(acc => {
      if (acc.password === '••••••••') {
        const prev = existingAccounts.find(e => e.id === acc.id)
        return { ...acc, password: prev?.password ?? '' }
      }
      return acc
    })

    await Setting.findOneAndUpdate(
      { key: KEY },
      { key: KEY, value: JSON.stringify(merged), group: 'email' },
      { upsert: true, new: true }
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PUT /api/settings/email]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
