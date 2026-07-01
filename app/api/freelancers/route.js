export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer, FreelancerAssignment, SalaryPayout } from '@/models'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { ciEquals, ciContains } from '@/lib/searchMatch'
import { requireStaff, requirePerm } from '@/lib/rbac'
import { maskList, FREELANCER_PII } from '@/lib/pii'
import { sendFreelancerInviteEmail, sendEmployeeLoginEmail } from '@/lib/mailer'
import { sendFreelancerInviteWhatsApp } from '@/lib/whatsapp'
import { getConfig } from '@/lib/getConfig'
import { logActivity } from '@/lib/logActivity'

// GET /api/freelancers
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)   // freelancer directory exposes bank details — staff only
    if (denied) return denied

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
        $or: [{ name: ciContains(search) }, { email: ciContains(search) }, { phone: ciContains(search) }],
      }).select('_id').lean()
      const userIds = matchingUsers.map(u => u._id)
      filter.$or = [
        { userId: { $in: userIds } },
        { skills: ciContains(search) },
        { 'agencyInfo.agencyName': ciContains(search) },
      ]
    }

    const [freelancers, total] = await Promise.all([
      Freelancer.find(filter)
        .skip(skip).limit(limit).sort({ createdAt: -1 })
        .populate({ path: 'userId', select: 'id name email avatar phone isActive' })
        .populate({ path: 'pricing.categoryId', select: 'id name unit defaultPrice' }),
      Freelancer.countDocuments(filter),
    ])

    // Per-freelancer money rollups for this page (owed/paid in BDT-equivalent) +
    // last activity, computed with aggregation. amountBDT falls back to the
    // original amount for legacy/BDT rows.
    const ids = freelancers.map(f => f._id)
    const [asgRollup, salRollup] = await Promise.all([
      FreelancerAssignment.aggregate([
        { $match: { freelancerId: { $in: ids }, paymentStatus: { $ne: 'NOT_REQUIRED' } } },
        { $group: {
          _id: '$freelancerId',
          owed: { $sum: { $cond: [
            { $or: [
              { $and: [{ $eq: ['$status', 'COMPLETED'] }, { $ne: ['$paymentStatus', 'PAID'] }] },
              { $eq: ['$paymentStatus', 'PAYMENT_REQUESTED'] },
            ] },
            { $ifNull: ['$amountBDT', '$paymentAmount'] }, 0,
          ] } },
          paid: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, { $ifNull: ['$amountBDT', '$paymentAmount'] }, 0] } },
          lastWorkedAt: { $max: '$updatedAt' },
        } },
      ]),
      SalaryPayout.aggregate([
        { $match: { freelancerId: { $in: ids } } },
        { $group: {
          _id: '$freelancerId',
          owed: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, { $ifNull: ['$amountBDT', '$amount'] }, 0] } },
          paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, { $ifNull: ['$amountBDT', '$amount'] }, 0] } },
        } },
      ]),
    ])
    const financeMap = new Map()
    for (const r of asgRollup) financeMap.set(String(r._id), { owedBDT: r.owed || 0, paidBDT: r.paid || 0, lastWorkedAt: r.lastWorkedAt ?? null })
    for (const r of salRollup) {
      const cur = financeMap.get(String(r._id)) ?? { owedBDT: 0, paidBDT: 0, lastWorkedAt: null }
      cur.owedBDT += r.owed || 0
      cur.paidBDT += r.paid || 0
      financeMap.set(String(r._id), cur)
    }

    const data = maskList(session, freelancers.map(f => f.toJSON()), FREELANCER_PII)
      .map(f => {
        const fin = financeMap.get(String(f.id)) ?? { owedBDT: 0, paidBDT: 0, lastWorkedAt: null }
        return { ...f, finance: { ...fin, hasUnpaid: fin.owedBDT > 0 } }
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
    const denied = requirePerm(session, 'hr.freelancers.manage')
    if (denied) return denied

    await connectDB()

    const body = await request.json()
    const {
      type = 'FREELANCER',
      name,
      email,
      phone,
      skills,
      bio,
      // Engagement model — freelancers carry NO rate by default; rate is decided
      // per project/task. SALARY mode = temporary salary-based hire.
      employmentMode = 'PROJECT',
      paymentCurrency = 'BDT',
      salaryAmount,
      salaryCurrency,
      salaryDay,
      salaryStartDate,
      salaryEndDate,
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

    const existing = await User.findOne({ email: ciEquals(email) }).select('_id').lean()
    if (existing) return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

    const cfg = await getConfig()
    const requireVerification = cfg.verification?.freelancer !== false

    // Generate a random secure password (user will set their own if verification is on,
    // or receive it directly if verification is off)
    const randomPassword = crypto.randomBytes(16).toString('hex') + 'A1!'
    const hashedPassword = await bcrypt.hash(randomPassword, 12)

    // Invite token is only needed when the verification flow is active
    const inviteToken       = requireVerification ? crypto.randomBytes(32).toString('hex') : null
    const inviteTokenExpiry = requireVerification ? new Date(Date.now() + 48 * 60 * 60 * 1000) : null

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
      employmentMode: employmentMode === 'SALARY' ? 'SALARY' : 'PROJECT',
      paymentCurrency: paymentCurrency || 'BDT',
      inviteToken,
      inviteTokenExpiry,
      // When verification is off, account is immediately active
      inviteAccepted: !requireVerification,
    }

    if (employmentMode === 'SALARY') {
      freelancerData.salaryAmount    = salaryAmount ?? null
      freelancerData.salaryCurrency  = salaryCurrency || paymentCurrency || 'BDT'
      freelancerData.salaryDay       = salaryDay ?? null
      freelancerData.salaryStartDate = salaryStartDate || null
      freelancerData.salaryEndDate   = salaryEndDate || null
      freelancerData.salaryActive    = Boolean(salaryAmount && salaryDay)
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

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'FREELANCER',
      entityId: freelancer._id.toString(),
      changes:  JSON.stringify({ name: displayName, type }),
      request,
    })

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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
