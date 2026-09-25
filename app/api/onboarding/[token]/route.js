export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding, User, Employee } from '@/models'
import { ciEquals } from '@/lib/searchMatch'

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
      dateOfBirth, nidNumber, address, emergencyContacts,
      bloodGroup, photo, documents, password,
    } = body

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 422 })
    }

    // The account is created for the invited address only. Never bind the
    // record to a pre-existing account (that would drop the chosen password and
    // let HR's approve step overwrite someone else's employment details).
    const invited   = record.email ? String(record.email).trim() : null
    const submitted = typeof email === 'string' ? email.trim() : ''
    if (invited && submitted && submitted.toLowerCase() !== invited.toLowerCase()) {
      return NextResponse.json({ error: 'Please use the email address this invitation was sent to' }, { status: 422 })
    }
    const userEmail = invited || submitted
    if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 422 })
    }
    if (await User.exists({ email: ciEquals(userEmail) })) {
      return NextResponse.json({ error: 'An account with this email already exists. Please contact HR.' }, { status: 409 })
    }

    // Keep only well-formed document entries ({ url, type, name }) from our uploads.
    const DOC_TYPES = ['NID', 'BIRTH_CERTIFICATE', 'CV', 'PASSPORT', 'ACADEMIC', 'OTHER']
    const cleanDocs = (Array.isArray(documents) ? documents : [])
      .filter(d => d && typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//') && d.url.length <= 2048)
      .slice(0, 50)
      .map(d => ({
        url:  d.url,
        type: DOC_TYPES.includes(d.type) ? d.type : 'OTHER',
        name: typeof d.name === 'string' ? d.name.slice(0, 200) || null : null,
      }))

    record.selfData = {
      name:             name             || null,
      email:            userEmail,
      phone:            phone            || null,
      secondaryPhone:   secondaryPhone   || null,
      homePhone:        homePhone        || null,
      dateOfBirth:      dateOfBirth      ? new Date(dateOfBirth) : null,
      nidNumber:        nidNumber        || null,
      address:          address          || null,
      emergencyContacts: Array.isArray(emergencyContacts) ? emergencyContacts : [],
      bloodGroup:        bloodGroup       || null,
      photo:             photo            || null,
      documents:         cleanDocs,
    }

    // ── Auto-create User + Employee account immediately ──────────────────────
    const bcrypt = (await import('bcryptjs')).default

    const user = await new User({
      name:     name  || 'Employee',
      email:    userEmail,
      phone:    phone || null,
      password: await bcrypt.hash(password, 10),
      role:     'EMPLOYEE',
      avatar:   photo || null,
      isActive: true,
    }).save()

    let employee
    try {
      employee = await new Employee({
        userId:           user._id,
        phone:            phone            || null,
        secondaryPhone:   secondaryPhone   || null,
        homePhone:        homePhone        || null,
        dateOfBirth:      dateOfBirth      ? new Date(dateOfBirth) : null,
        bloodGroup:       bloodGroup       || null,
        emergencyContacts: Array.isArray(emergencyContacts) ? emergencyContacts : [],
        address:          address          || null,
        nidNumber:        nidNumber        || null,
        photo:            photo            || null,
        documents:        cleanDocs,
        panelAccessGranted: true,
      }).save()
    } catch (e) {
      await User.deleteOne({ _id: user._id }).catch(() => {})
      throw e
    }

    // Mark as approved immediately — HR still fills employment details later
    record.status      = 'APPROVED'
    record.submittedAt = new Date()
    record.approvedAt  = new Date()
    record.employeeId  = employee._id
    await record.save()

    return NextResponse.json({
      success:    true,
      email:      userEmail,
      employeeId: employee.id,
    })
  } catch (err) {
    console.error('[PATCH /api/onboarding/[token]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
