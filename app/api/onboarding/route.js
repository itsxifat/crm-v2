export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding } from '@/models'
import { sendOnboardingEmail } from '@/lib/mailer'
import { sendOnboardingWhatsApp } from '@/lib/whatsapp'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskList, maskPhone } from '@/lib/pii'

// Same categories as EMPLOYEE_PII, for the onboarding record's nested shape.
const ONBOARDING_PII = {
  'pii.contact.view': [
    ['selfData.email', 'email'], ['selfData.phone', 'phone'],
    ['selfData.secondaryPhone', 'phone'], ['selfData.homePhone', 'phone'],
    ['hrData.companyPhone', 'phone'], ['hrData.companyWebmail', 'email'],
  ],
  'pii.address.view': [
    ['selfData.address', 'address'],
  ],
  'pii.identity.view': [
    ['selfData.nidNumber', 'identity'], ['selfData.dateOfBirth', 'text'],
  ],
  'pii.financial.view': [
    ['hrData.salary', 'money'],
  ],
}

// GET /api/onboarding — list all (HR only)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.view')
    if (denied) return denied

    await connectDB()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const filter = status ? { status: String(status) } : {}

    const items = await EmployeeOnboarding.find(filter)
      .select('-hrData.password')
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name')
      .populate('hrData.customRoleId', 'id title department color')

    const data = maskList(session, items.map(i => i.toJSON()), ONBOARDING_PII)
    if (!canDo(session, 'pii.contact.view')) {
      for (const d of data) {
        if (Array.isArray(d.selfData?.emergencyContacts)) {
          d.selfData.emergencyContacts = d.selfData.emergencyContacts.map(c => ({ ...c, phone: maskPhone(c?.phone) }))
        }
      }
    }
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/onboarding]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/onboarding — create onboarding link (HR only)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.create')
    if (denied) return denied

    await connectDB()
    const { email, name, phone } = await request.json().catch(() => ({}))

    if (!email) return NextResponse.json({ error: 'Employee email is required' }, { status: 422 })

    const record = await new EmployeeOnboarding({
      email,
      createdBy: session.user.id,
    }).save()

    // Send onboarding email
    const origin = request.headers.get('origin') || process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const link   = `${origin}/onboarding/${record.token}`

    let emailSent = true
    try {
      await sendOnboardingEmail({ to: email, name: name || null, link, expiresAt: record.expiresAt })
    } catch (mailErr) {
      console.error('[POST /api/onboarding] email failed:', mailErr.message)
      emailSent = false
    }

    // Fire-and-forget WhatsApp (requires phone number)
    if (phone) {
      sendOnboardingWhatsApp({ to: phone, name: name || null, link, expiresAt: record.expiresAt })
    }

    return NextResponse.json({ data: record.toJSON(), emailSent, link }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/onboarding]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
