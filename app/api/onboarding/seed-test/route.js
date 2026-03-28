// DEV-ONLY — creates a dummy PENDING_SUBMISSION onboarding record for testing
// Access: GET /api/onboarding/seed-test
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding } from '@/models'

export async function GET(request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  await connectDB()

  const record = await new EmployeeOnboarding({
    email: 'test.employee@en-tech.agency',
    status: 'PENDING_SUBMISSION',
  }).save()

  const origin = request.headers.get('origin') || `http://localhost:${process.env.PORT ?? 3000}`
  const link   = `${origin}/onboarding/${record.token}`

  return NextResponse.json({
    message: 'Dummy onboarding record created',
    token:   record.token,
    link,
    expiresAt: record.expiresAt,
  })
}

// Also seed a SUBMITTED record (to test HR review panel)
export async function POST(request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  await connectDB()

  const record = await new EmployeeOnboarding({
    email:  'submitted.employee@en-tech.agency',
    status: 'SUBMITTED',
    submittedAt: new Date(),
    selfData: {
      name:             'Rahim Uddin',
      email:            'rahim@en-tech.agency',
      phone:            '+8801711234567',
      secondaryPhone:   '+8801811234567',
      homePhone:        null,
      dateOfBirth:      new Date('1997-06-15'),
      nidNumber:        '1991234567890',
      address:          'House 12, Road 5, Dhanmondi, Dhaka-1205',
      emergencyContact: 'Karim Uddin — +8801911234567',
      bloodGroup:       'B+',
      photo:            null,
      documents:        [],
    },
  }).save()

  const origin = request.headers.get('origin') || `http://localhost:${process.env.PORT ?? 3000}`
  const link   = `${origin}/onboarding/${record.token}`

  return NextResponse.json({
    message: 'Dummy SUBMITTED onboarding record created — check HR review panel in /admin/employees',
    token:   record.token,
    link,
  })
}
