export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer, FreelancerAssignment, SalaryPayout } from '@/models'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { ciEquals, ciContains } from '@/lib/searchMatch'
import { requireStaff, requirePerm, canDo } from '@/lib/rbac'
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
    const verification = searchParams.get('verification') ?? null  // pending | verified | unverified
    const activity = searchParams.get('activity') ?? null  // active | inactive (last engagement update within 30 days)
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip   = (page - 1) * limit

    const filter = {}

    if (type && ['FREELANCER', 'AGENCY'].includes(type)) {
      filter.type = type
    }

    // KYC / verification status filter
    if (verification === 'pending')    filter.profileStatus = 'PENDING_APPROVAL'
    if (verification === 'verified')   filter.profileStatus = 'APPROVED'
    if (verification === 'unverified') filter.profileStatus = { $ne: 'APPROVED' }

    // Activity filter — applied before pagination so page counts stay correct.
    // "Recently active" = an engagement updated in the last 30 days (matches the
    // list's lastWorkedAt, which is the latest assignment updatedAt).
    if (activity === 'active' || activity === 'inactive') {
      const cutoff = new Date(Date.now() - 31 * 86_400_000)
      const activeIds = await FreelancerAssignment.distinct('freelancerId', { updatedAt: { $gt: cutoff } })
      filter._id = activity === 'active' ? { $in: activeIds } : { $nin: activeIds }
    }

    if (search) {
      // Email/phone are only searchable for callers who may see them unmasked.
      const matchingUsers = await User.find({
        $or: canDo(session, 'pii.contact.view')
          ? [{ name: ciContains(search) }, { email: ciContains(search) }, { phone: ciContains(search) }]
          : [{ name: ciContains(search) }],
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
    // original amount only for BDT (or legacy currency-less) rows; a foreign
    // amount with no BDT-equivalent (e.g. a cron-created USD salary payout) is
    // never added to the BDT total — it is reported per currency in owedOther.
    const bdtValue = (amountField) => ({
      $cond: [
        { $ne: [{ $ifNull: ['$amountBDT', null] }, null] }, '$amountBDT',
        { $cond: [{ $in: [{ $ifNull: ['$currency', 'BDT'] }, ['BDT']] }, { $ifNull: [amountField, 0] }, 0] },
      ],
    })
    const isUnconverted = { $and: [
      { $eq: [{ $ifNull: ['$amountBDT', null] }, null] },
      { $not: [{ $in: [{ $ifNull: ['$currency', 'BDT'] }, ['BDT']] }] },
    ] }
    const asgOwedCond = { $and: [
      { $ne: ['$paymentStatus', 'NOT_REQUIRED'] },
      { $or: [
        { $and: [{ $eq: ['$status', 'COMPLETED'] }, { $ne: ['$paymentStatus', 'PAID'] }] },
        { $eq: ['$paymentStatus', 'PAYMENT_REQUESTED'] },
      ] },
    ] }
    const ids = freelancers.map(f => f._id)
    const [asgRollup, salRollup, unconvertedOwed] = await Promise.all([
      // No NOT_REQUIRED exclusion in $match: salary-based engagements must
      // still count towards lastWorkedAt. The owed/paid conditions skip them.
      FreelancerAssignment.aggregate([
        { $match: { freelancerId: { $in: ids } } },
        { $group: {
          _id: '$freelancerId',
          owed: { $sum: { $cond: [asgOwedCond, bdtValue('$paymentAmount'), 0] } },
          paid: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, bdtValue('$paymentAmount'), 0] } },
          lastWorkedAt: { $max: '$updatedAt' },
        } },
      ]),
      SalaryPayout.aggregate([
        { $match: { freelancerId: { $in: ids } } },
        { $group: {
          _id: '$freelancerId',
          owed: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, bdtValue('$amount'), 0] } },
          paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, bdtValue('$amount'), 0] } },
        } },
      ]),
      // Owed amounts in a foreign currency with no BDT-equivalent yet.
      Promise.all([
        FreelancerAssignment.aggregate([
          { $match: { freelancerId: { $in: ids } } },
          { $match: { $expr: { $and: [asgOwedCond, isUnconverted] } } },
          { $group: { _id: { f: '$freelancerId', currency: '$currency' }, total: { $sum: '$paymentAmount' } } },
        ]),
        SalaryPayout.aggregate([
          { $match: { freelancerId: { $in: ids }, status: 'PENDING' } },
          { $match: { $expr: isUnconverted } },
          { $group: { _id: { f: '$freelancerId', currency: '$currency' }, total: { $sum: '$amount' } } },
        ]),
      ]).then(([a, b]) => [...a, ...b]),
    ])
    const financeMap = new Map()
    const blank = () => ({ owedBDT: 0, paidBDT: 0, owedOther: [], lastWorkedAt: null })
    for (const r of asgRollup) financeMap.set(String(r._id), { ...blank(), owedBDT: r.owed || 0, paidBDT: r.paid || 0, lastWorkedAt: r.lastWorkedAt ?? null })
    for (const r of salRollup) {
      const cur = financeMap.get(String(r._id)) ?? blank()
      cur.owedBDT += r.owed || 0
      cur.paidBDT += r.paid || 0
      financeMap.set(String(r._id), cur)
    }
    for (const r of unconvertedOwed) {
      if (!r.total) continue
      const cur = financeMap.get(String(r._id.f)) ?? blank()
      const row = cur.owedOther.find(o => o.currency === r._id.currency)
      if (row) row.total += r.total
      else cur.owedOther.push({ currency: r._id.currency, total: r.total })
      financeMap.set(String(r._id.f), cur)
    }

    const data = maskList(session, freelancers.map(f => f.toJSON()), FREELANCER_PII)
      .map(f => {
        const fin = financeMap.get(String(f.id)) ?? { owedBDT: 0, paidBDT: 0, owedOther: [], lastWorkedAt: null }
        return { ...f, finance: { ...fin, hasUnpaid: fin.owedBDT > 0 || fin.owedOther.length > 0 } }
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
    const notStaff = requireStaff(session)
    if (notStaff) return notStaff

    const body = await request.json()
    // Agencies are managed under hr.agencies.manage, freelancers under hr.freelancers.manage.
    const denied = requirePerm(session, body?.type === 'AGENCY' ? 'hr.agencies.manage' : 'hr.freelancers.manage')
    if (denied) return denied

    await connectDB()
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
          email:    email.toLowerCase(),
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
