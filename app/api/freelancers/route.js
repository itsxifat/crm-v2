export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer } from '@/models'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { blindIndex } from '@/lib/encryption'
import { sendFreelancerInviteEmail, sendEmployeeLoginEmail } from '@/lib/mailer'
import { sendFreelancerInviteWhatsApp } from '@/lib/whatsapp'
import { getConfig } from '@/lib/getConfig'

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
      const emailToken = blindIndex(search.toLowerCase(), 'users', 'email')
      const phoneToken = blindIndex(search, 'users', 'phone')
      const matchingUsers = await User.find({
        $or: [{ emailIdx: emailToken }, { phoneIdx: phoneToken }],
      }).select('_id').select('+emailIdx +phoneIdx').lean()
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

    const [freelancers, total] = await Promise.all([
      query,
      Freelancer.countDocuments(filter),
    ])

    // pricing is stored as an encrypted blob (Mixed type); Mongoose 8 strictPopulate
    // cannot resolve sub-paths of Mixed fields, so we manually populate categoryId
    // references after decryption. The list view only shows hourlyRate/rateType anyway,
    // but we still resolve categories so the edit modal can prefill correctly.
    let categoryMap = {}
    if (!isFreelancerRole) {
      const { PricingCategory } = await import('@/models')
      const categoryIds = [
        ...new Set(
          freelancers.flatMap(f =>
            Array.isArray(f.pricing)
              ? f.pricing.map(p => p?.categoryId?.toString()).filter(Boolean)
              : []
          )
        ),
      ]
      if (categoryIds.length > 0) {
        const cats = await PricingCategory.find({ _id: { $in: categoryIds } }).lean()
        categoryMap = Object.fromEntries(cats.map(c => [c._id.toString(), c]))
      }
    }

    const data = freelancers.map(f => {
      const obj = f.toJSON()
      if (isFreelancerRole) {
        delete obj.pricing
      } else if (Array.isArray(obj.pricing)) {
        obj.pricing = obj.pricing.map(p => ({
          ...p,
          categoryId: p?.categoryId ? (categoryMap[p.categoryId.toString()] ?? p.categoryId) : null,
        }))
      }
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

    const emailToken = blindIndex(email.toLowerCase(), 'users', 'email')
    const existing = await User.findOne({ emailIdx: emailToken }).select('+emailIdx').lean()
    if (existing) {
      // Check for orphaned user: User exists but has no Freelancer document.
      // This happens when a previous POST created the User but crashed before
      // saving the Freelancer. Clean up the orphan and allow re-creation.
      const orphanFreelancer = await Freelancer.findOne({ userId: existing._id }).lean()
      if (!orphanFreelancer && existing.role === 'FREELANCER') {
        await User.deleteOne({ _id: existing._id })
        // fall through to create fresh user + freelancer below
      } else {
        return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
      }
    }

    const cfg = await getConfig()
    const requireVerification = cfg.verification?.freelancer !== false

    // Generate a random secure password (user will set their own if verification is on,
    // or receive it directly if verification is off)
    const randomPassword = crypto.randomBytes(16).toString('hex') + 'A1!'
    const hashedPassword = await bcrypt.hash(randomPassword, 12)

    // Invite token is only needed when the verification flow is active
    const inviteToken       = requireVerification ? crypto.randomBytes(32).toString('hex') : undefined
    const inviteTokenExpiry = requireVerification ? new Date(Date.now() + 48 * 60 * 60 * 1000) : undefined

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
      // When verification is off, account is immediately active
      inviteAccepted: !requireVerification,
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

    let freelancer
    try {
      freelancer = await new Freelancer(freelancerData).save()
    } catch (freelancerErr) {
      // Roll back the user we just created so the email isn't permanently blocked.
      await User.deleteOne({ _id: user._id }).catch(() => {})
      throw freelancerErr
    }
    await freelancer.populate({ path: 'userId', select: 'id name email avatar phone isActive' })

    let emailSent = false

    if (requireVerification) {
      // Invite flow: send a link for the user to set their own password
      const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/freelancer/invite/${inviteToken}`
      try {
        await sendFreelancerInviteEmail({
          to:       email.toLowerCase(),
          name:     displayName,
          link:     inviteLink,
          type,
          password: randomPassword,
        })
        emailSent = true
      } catch (emailErr) {
        console.error('[POST /api/freelancers] invite email failed:', emailErr)
      }

      if (phone) {
        sendFreelancerInviteWhatsApp({
          to:       phone,
          name:     displayName,
          link:     inviteLink,
          type,
          password: randomPassword,
        })
      }

      const response = { data: freelancer, emailSent, verificationRequired: true }
      if (!emailSent) response.link = inviteLink
      return NextResponse.json(response, { status: 201 })
    }

    // No-verification flow: account is immediately active, send login credentials directly
    try {
      await sendEmployeeLoginEmail({ to: email.toLowerCase(), name: displayName, password: randomPassword })
      emailSent = true
    } catch (emailErr) {
      console.error('[POST /api/freelancers] welcome email failed:', emailErr)
    }

    return NextResponse.json({
      data:                freelancer,
      emailSent,
      verificationRequired: false,
      tempPassword:         randomPassword,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/freelancers]', err)
    return NextResponse.json({
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { detail: err.message, stack: err.stack }),
    }, { status: 500 })
  }
}
