export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee } from '@/models'
import { calcProfileCompletion } from '@/models/Employee'
import { sendProfileCompleteToHR } from '@/lib/mailer'
import { z } from 'zod'

const profileSchema = z.object({
  // Personal
  gender:        z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  dateOfBirth:   z.string().optional().nullable(),
  nationality:   z.string().optional().nullable(),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']).optional().nullable(),
  // Upload API returns relative paths like /uploads/receipts/uuid.jpg — no strict URL validation
  photo:         z.string().min(1).optional().nullable(),

  // Contact
  phone:            z.string().optional().nullable(),
  secondaryPhone:   z.string().optional().nullable(),
  address:          z.string().optional().nullable(),
  emergencyContacts: z.array(z.object({
    name:     z.string().min(1),
    relation: z.string().min(1),
    phone:    z.string().min(1),
  })).optional(),

  // KYC
  nidNumber:      z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  documents:      z.array(z.object({
    url:  z.string().min(1),  // relative or absolute — upload API returns /uploads/...
    type: z.enum(['NID','BIRTH_CERTIFICATE','CV','PASSPORT','ACADEMIC','APPOINTMENT','AGREEMENT','PHOTO','OTHER']),
    name: z.string().optional().nullable(),
  })).optional(),
})

// GET /api/employee/profile — fetch own profile
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const user = await User.findById(session.user.id).select('name email avatar role').lean()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const emp  = await Employee.findOne({ userId: session.user.id })
      .populate({ path: 'customRoleId', select: 'id title department color' })
      .lean()

    if (!emp) return NextResponse.json({ error: 'Employee record not found' }, { status: 404 })

    return NextResponse.json({ data: { ...emp, user } })
  } catch (err) {
    console.error('[GET /api/employee/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/employee/profile — employee updates their own profile
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const emp = await Employee.findOne({ userId: session.user.id })
    if (!emp) return NextResponse.json({ error: 'Employee record not found' }, { status: 404 })

    // After final approval, KYC fields and core identity fields are locked
    if (emp.finalApproved) {
      return NextResponse.json({ error: 'Profile is locked after final approval' }, { status: 403 })
    }

    const body   = await request.json()
    const parsed = profileSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = parsed.data

    // KYC fields locked after kycApproved
    const kycLocked = emp.kycApproved
    const allowed = {
      gender:           data.gender,
      dateOfBirth:      data.dateOfBirth ? new Date(data.dateOfBirth) : emp.dateOfBirth,
      nationality:      data.nationality,
      maritalStatus:    data.maritalStatus,
      photo:            data.photo,
      phone:            data.phone,
      secondaryPhone:   data.secondaryPhone,
      address:          data.address,
      emergencyContacts: data.emergencyContacts,
    }

    if (!kycLocked) {
      if (data.nidNumber      !== undefined) allowed.nidNumber      = data.nidNumber
      if (data.passportNumber !== undefined) allowed.passportNumber = data.passportNumber
      if (data.documents      !== undefined) allowed.documents      = data.documents
    }

    // Remove undefined keys so we don't overwrite existing data with undefined
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k])

    Object.assign(emp, allowed)

    // Recalculate completion
    const pct = calcProfileCompletion(emp)
    emp.profileCompletionPct = pct

    const wasBelow100 = emp.profileStatus !== 'PENDING_APPROVAL' && emp.profileStatus !== 'APPROVED'

    if (pct === 100 && wasBelow100) {
      emp.profileStatus = 'PENDING_APPROVAL'
    } else if (pct < 100 && !['APPROVED'].includes(emp.profileStatus)) {
      emp.profileStatus = 'INCOMPLETE'
    }

    await emp.save()

    // Notify HR when profile just hit 100% for the first time
    if (pct === 100 && wasBelow100) {
      const user    = await User.findById(session.user.id).select('name email').lean()
      const appUrl  = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const hrUsers = await User.find({ role: { $in: ['SUPER_ADMIN', 'MANAGER'] } }).select('email').lean()

      hrUsers.forEach(hr => {
        sendProfileCompleteToHR({
          to:            hr.email,
          employeeName:  user.name,
          employeeEmail: user.email,
          profileUrl:    `${appUrl}/admin/employees/${emp._id}`,
        }).catch(err => console.error('[profile complete HR notify]', err.message))
      })
    }

    return NextResponse.json({ data: emp, profileCompletionPct: pct, profileStatus: emp.profileStatus })
  } catch (err) {
    console.error('[PUT /api/employee/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
