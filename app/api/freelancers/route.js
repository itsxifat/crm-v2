import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer } from '@/models'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { sendFreelancerInviteEmail } from '@/lib/mailer'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

// GET /api/freelancers
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { role } = session.user
    if (![...STAFF_ROLES, 'FREELANCER'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? ''
    const type   = searchParams.get('type') ?? null
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip   = (page - 1) * limit

    const filter = {}

    if (type && ['FREELANCER', 'AGENCY'].includes(type)) {
      filter.type = type
    }

    if (search) {
      const matchingUsers = await User.find({
        $or: [
          { name:  { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ],
      }).select('_id').lean()
      const userIds = matchingUsers.map(u => u._id)
      filter.$or = [
        { userId: { $in: userIds } },
        { skills: { $regex: search, $options: 'i' } },
        { 'agencyInfo.agencyName': { $regex: search, $options: 'i' } },
      ]
    }

    const isFreelancerRole = role === 'FREELANCER'

    let query = Freelancer.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })

    if (!isFreelancerRole) {
      query = query.populate({ path: 'pricing.categoryId', select: 'id name unit defaultPrice' })
    }

    const [freelancers, total] = await Promise.all([
      query,
      Freelancer.countDocuments(filter),
    ])

    const data = freelancers.map(f => {
      const obj = f.toJSON()
      if (isFreelancerRole) delete obj.pricing
      return obj
    })

    return NextResponse.json({
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/freelancers]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/freelancers
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()
    const {
      type = 'FREELANCER',
      name,
      email,
      phone,
      skills,
      bio,
      rateType,
      hourlyRate,
      agencyInfo,
      contactPerson,
    } = body

    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 422 })
    if (!type || !['FREELANCER', 'AGENCY'].includes(type)) {
      return NextResponse.json({ error: 'type must be FREELANCER or AGENCY' }, { status: 422 })
    }

    if (type === 'AGENCY') {
      if (!agencyInfo?.agencyName) {
        return NextResponse.json({ error: 'agencyInfo.agencyName is required for AGENCY type' }, { status: 422 })
      }
    } else {
      if (!name) return NextResponse.json({ error: 'name is required' }, { status: 422 })
    }

    const displayName = type === 'AGENCY'
      ? (contactPerson?.name ?? agencyInfo?.agencyName ?? 'Agency')
      : name

    const existing = await User.findOne({ email: email.toLowerCase() }).lean()
    if (existing) return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

    // Generate a random secure password (user will set their own)
    const randomPassword = crypto.randomBytes(16).toString('hex') + 'A1!'
    const hashedPassword = await bcrypt.hash(randomPassword, 12)

    // Generate invite token
    const inviteToken       = crypto.randomBytes(32).toString('hex')
    const inviteTokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000)

    const user = await new User({
      email:    email.toLowerCase(),
      password: hashedPassword,
      name:     displayName,
      role:     'FREELANCER',
      phone:    phone ?? null,
      isActive: true,
    }).save()

    const freelancerData = {
      userId: user._id,
      type,
      skills:   skills ?? null,
      bio:      bio    ?? null,
      rateType: rateType ?? null,
      hourlyRate: hourlyRate ?? null,
      inviteToken,
      inviteTokenExpiry,
      inviteAccepted: false,
    }

    if (type === 'AGENCY' && agencyInfo) {
      freelancerData.agencyInfo = {
        agencyName: agencyInfo.agencyName ?? null,
        phone:      agencyInfo.phone      ?? null,
        address:    agencyInfo.address    ?? null,
        type:       agencyInfo.type       ?? null,
      }
    }

    if (contactPerson) {
      freelancerData.contactPerson = {
        name:        contactPerson.name        ?? null,
        phone:       contactPerson.phone       ?? null,
        email:       contactPerson.email       ?? null,
        designation: contactPerson.designation ?? null,
      }
    }

    const freelancer = await new Freelancer(freelancerData).save()
    await freelancer.populate({ path: 'userId', select: 'id name email avatar phone isActive' })

    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/freelancer/invite/${inviteToken}`

    let emailSent = false
    try {
      await sendFreelancerInviteEmail({
        to:   email.toLowerCase(),
        name: displayName,
        link: inviteLink,
        type,
      })
      emailSent = true
    } catch (emailErr) {
      console.error('[POST /api/freelancers] email send failed:', emailErr)
    }

    const response = { data: freelancer, emailSent }
    if (!emailSent) response.link = inviteLink

    return NextResponse.json(response, { status: 201 })
  } catch (err) {
    console.error('[POST /api/freelancers]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
