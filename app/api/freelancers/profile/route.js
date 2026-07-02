export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, User } from '@/models'
import { calcFreelancerProfileCompletion } from '@/models/Freelancer'
import { sendFreelancerKycSubmittedToAdmin } from '@/lib/mailer'
import { z } from 'zod'

// GET /api/freelancers/profile — returns current freelancer's own profile (FREELANCER role only)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'FREELANCER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const freelancer = await Freelancer.findOne({ userId: session.user.id })
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })
      .select('-pricing')
      .lean()

    if (!freelancer) return NextResponse.json({ error: 'Freelancer profile not found' }, { status: 404 })

    // Ensure id is serialised
    const data = {
      ...freelancer,
      id: freelancer._id.toString(),
    }
    delete data._id
    delete data.__v

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/freelancers/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const kycSchema = z.object({
  // Individual identity
  photo:          z.string().min(1).optional().nullable(),
  address:        z.string().optional().nullable(),
  nidNumber:      z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  skills:         z.string().optional().nullable(),
  bio:            z.string().optional().nullable(),
  portfolioLinks: z.string().optional().nullable(),
  documents:      z.array(z.object({
    url:  z.string().min(1),
    type: z.string().min(1),
    name: z.string().optional().nullable(),
  })).optional(),
  // Agency
  agencyInfo: z.object({
    agencyName: z.string().optional().nullable(),
    phone:      z.string().optional().nullable(),
    address:    z.string().optional().nullable(),
    type:       z.string().optional().nullable(),
  }).optional(),
  contactPerson: z.object({
    name:        z.string().optional().nullable(),
    phone:       z.string().optional().nullable(),
    email:       z.string().optional().nullable(),
    designation: z.string().optional().nullable(),
  }).optional(),
})

// PUT /api/freelancers/profile — freelancer/agency submits/updates their own KYC
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'FREELANCER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const fl = await Freelancer.findOne({ userId: session.user.id })
    if (!fl) return NextResponse.json({ error: 'Freelancer profile not found' }, { status: 404 })

    // Locked once verified — resubmission only allowed while unverified.
    if (fl.kycApproved) {
      return NextResponse.json({ error: 'Profile is locked after verification' }, { status: 403 })
    }

    const body   = await request.json()
    const parsed = kycSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data

    const allowed = {
      photo:          data.photo,
      address:        data.address,
      nidNumber:      data.nidNumber,
      passportNumber: data.passportNumber,
      skills:         data.skills,
      bio:            data.bio,
      portfolioLinks: data.portfolioLinks,
      documents:      data.documents,
    }
    // Nested objects: merge so unspecified sub-fields are preserved.
    if (data.agencyInfo)    allowed.agencyInfo    = { ...(fl.agencyInfo?.toObject?.() ?? fl.agencyInfo ?? {}), ...data.agencyInfo }
    if (data.contactPerson) allowed.contactPerson = { ...(fl.contactPerson?.toObject?.() ?? fl.contactPerson ?? {}), ...data.contactPerson }

    // Drop undefined so we never overwrite existing values with undefined.
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k])
    Object.assign(fl, allowed)

    const pct = calcFreelancerProfileCompletion(fl)
    fl.profileCompletionPct = pct

    const wasBelow100 = fl.profileStatus !== 'PENDING_APPROVAL' && fl.profileStatus !== 'APPROVED'
    if (pct === 100 && wasBelow100) {
      fl.profileStatus = 'PENDING_APPROVAL'
    } else if (pct < 100 && fl.profileStatus !== 'APPROVED') {
      fl.profileStatus = 'INCOMPLETE'
    }

    await fl.save()

    // Notify admins when KYC just hit 100% for the first time.
    if (pct === 100 && wasBelow100) {
      const user    = await User.findById(session.user.id).select('name email').lean()
      const appUrl  = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const admins  = await User.find({ role: { $in: ['SUPER_ADMIN', 'MANAGER'] } }).select('email').lean()
      admins.forEach(admin => {
        sendFreelancerKycSubmittedToAdmin({
          to:             admin.email,
          freelancerName: user?.name,
          freelancerEmail: user?.email,
          isAgency:       fl.type === 'AGENCY',
          reviewUrl:      `${appUrl}/admin/freelancers/${fl._id}`,
        }).catch(err => console.error('[freelancer KYC submit notify]', err.message))
      })
    }

    return NextResponse.json({ data: fl, profileCompletionPct: pct, profileStatus: fl.profileStatus })
  } catch (err) {
    console.error('[PUT /api/freelancers/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
