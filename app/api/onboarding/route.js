import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding } from '@/models'
import { sendOnboardingEmail } from '@/lib/mailer'

// GET /api/onboarding — list all (HR only)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const filter = status ? { status } : {}

    const items = await EmployeeOnboarding.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name')
      .populate('hrData.customRoleId', 'id title department color')

    return NextResponse.json({ data: items.map(i => i.toJSON()) })
  } catch (err) {
    console.error('[GET /api/onboarding]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/onboarding — create onboarding link (HR only)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const { email, name } = await request.json().catch(() => ({}))

    if (!email) return NextResponse.json({ error: 'Employee email is required' }, { status: 422 })

    const record = await new EmployeeOnboarding({
      email,
      createdBy: session.user.id,
    }).save()

    // Send onboarding email
    const origin = request.headers.get('origin') || process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const link   = `${origin}/onboarding/${record.token}`

    try {
      await sendOnboardingEmail({ to: email, name: name || null, link, expiresAt: record.expiresAt })
    } catch (mailErr) {
      console.error('[POST /api/onboarding] email failed:', mailErr.message)
      // Return success but flag that email failed — link is still usable
      return NextResponse.json({ data: record.toJSON(), emailSent: false, link }, { status: 201 })
    }

    return NextResponse.json({ data: record.toJSON(), emailSent: true, link }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/onboarding]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
