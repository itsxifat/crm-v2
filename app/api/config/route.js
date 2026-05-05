export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

const CONFIG_KEY = 'crm_config'

const DEFAULT_PAYMENT_METHODS = [
  { value: 'CASH',          label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CARD',          label: 'Card' },
  { value: 'CHEQUE',        label: 'Cheque' },
  { value: 'BKASH',         label: 'bKash' },
  { value: 'NAGAD',         label: 'Nagad' },
  { value: 'ROCKET',        label: 'Rocket' },
  { value: 'ONLINE',        label: 'Online Transfer' },
  { value: 'OTHER',         label: 'Other' },
]

const DEFAULT_CONFIG = {
  leadSources:           [],
  leadPlatforms:         [],
  leadCategories:        [],
  leadServices:          [],
  leadBusinessCategories:[],
  companyItemCategories: [],
  ventures:              [],
  services:              {},
  paymentMethods:        DEFAULT_PAYMENT_METHODS,
  verification: {
    freelancer:         true,
    clientKyc:          true,
    employeeOnboarding: true,
  },
}

// GET /api/config
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const setting = await Setting.findOne({ key: CONFIG_KEY }).lean()
    if (!setting) {
      return NextResponse.json({ data: DEFAULT_CONFIG })
    }

    const saved  = JSON.parse(setting.value)
    const merged = {
      ...DEFAULT_CONFIG,
      ...saved,
      paymentMethods: saved.paymentMethods ?? DEFAULT_PAYMENT_METHODS,
      verification:   { ...DEFAULT_CONFIG.verification, ...(saved.verification ?? {}) },
    }
    return NextResponse.json({ data: merged })
  } catch (err) {
    console.error('[GET /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/config  — full replacement (used by config page)
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()
    await Setting.findOneAndUpdate(
      { key: CONFIG_KEY },
      { key: CONFIG_KEY, value: JSON.stringify(body), group: 'config' },
      { upsert: true, new: true }
    )

    return NextResponse.json({ data: body })
  } catch (err) {
    console.error('[PUT /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/config  — partial update, merges only the provided top-level keys
export async function PATCH(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const patch   = await request.json()
    const setting = await Setting.findOne({ key: CONFIG_KEY }).lean()
    const current = setting?.value ? JSON.parse(setting.value) : {}

    const updated = {
      ...DEFAULT_CONFIG,
      ...current,
      ...patch,
      paymentMethods: patch.paymentMethods ?? current.paymentMethods ?? DEFAULT_PAYMENT_METHODS,
      verification:   { ...DEFAULT_CONFIG.verification, ...(current.verification ?? {}), ...(patch.verification ?? {}) },
    }

    await Setting.findOneAndUpdate(
      { key: CONFIG_KEY },
      { key: CONFIG_KEY, value: JSON.stringify(updated), group: 'config' },
      { upsert: true, new: true }
    )

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PATCH /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
