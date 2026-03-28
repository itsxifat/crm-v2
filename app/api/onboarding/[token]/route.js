import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding, User, Employee } from '@/models'

// GET /api/onboarding/[token] — public: validate token & return prefill data
export async function GET(request, { params }) {
  try {
    await connectDB()
    const record = await EmployeeOnboarding.findOne({ token: params.token })
    if (!record) return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
    if (record.expiresAt < new Date() && record.status === 'PENDING_SUBMISSION')
      return NextResponse.json({ error: 'Link has expired' }, { status: 410 })
    if (record.status !== 'PENDING_SUBMISSION')
      return NextResponse.json({ error: 'This link has already been used' }, { status: 409 })

    return NextResponse.json({
      data: {
        email:     record.email,
        status:    record.status,
        expiresAt: record.expiresAt,
      },
    })
  } catch (err) {
    console.error('[GET /api/onboarding/[token]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/onboarding/[token] — public: employee submits selfData → account auto-created
export async function PATCH(request, { params }) {
  try {
    await connectDB()
    const record = await EmployeeOnboarding.findOne({ token: params.token })
    if (!record) return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
    if (record.expiresAt < new Date())
      return NextResponse.json({ error: 'Link has expired' }, { status: 410 })
    if (record.status !== 'PENDING_SUBMISSION')
      return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

    const body = await request.json()
    const {
      name, email, phone, secondaryPhone, homePhone,
      dateOfBirth, nidNumber, address, emergencyContact,
      bloodGroup, photo, documents,
    } = body

    record.selfData = {
      name:             name             || null,
      email:            email            || null,
      phone:            phone            || null,
      secondaryPhone:   secondaryPhone   || null,
      homePhone:        homePhone        || null,
      dateOfBirth:      dateOfBirth      ? new Date(dateOfBirth) : null,
      nidNumber:        nidNumber        || null,
      address:          address          || null,
      emergencyContact: emergencyContact || null,
      bloodGroup:       bloodGroup       || null,
      photo:            photo            || null,
      documents:        Array.isArray(documents) ? documents : [],
    }

    // ── Auto-create User + Employee account immediately ──────────────────────
    const bcrypt = (await import('bcryptjs')).default

    // Generate a random 10-char password: letters + numbers
    const rawPassword = Array.from({ length: 10 }, () =>
      'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'[
        Math.floor(Math.random() * 55)
      ]
    ).join('')

    const user = await new User({
      name:     name  || 'Employee',
      email:    email || record.email,
      phone:    phone || null,
      password: await bcrypt.hash(rawPassword, 10),
      role:     'EMPLOYEE',
      avatar:   photo || null,
      isActive: true,
    }).save()

    const employee = await new Employee({
      userId:           user._id,
      phone:            phone            || null,
      secondaryPhone:   secondaryPhone   || null,
      homePhone:        homePhone        || null,
      dateOfBirth:      dateOfBirth      ? new Date(dateOfBirth) : null,
      bloodGroup:       bloodGroup       || null,
      emergencyContact: emergencyContact || null,
      address:          address          || null,
      nidNumber:        nidNumber        || null,
      photo:            photo            || null,
      panelAccessGranted: true,
    }).save()

    // Mark as approved immediately — HR still fills employment details later
    record.status      = 'APPROVED'
    record.submittedAt = new Date()
    record.approvedAt  = new Date()
    record.employeeId  = employee._id
    await record.save()

    return NextResponse.json({
      success:     true,
      email:       email || record.email,
      password:    rawPassword,   // shown once on success screen
      employeeId:  employee.id,
    })
  } catch (err) {
    console.error('[PATCH /api/onboarding/[token]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
