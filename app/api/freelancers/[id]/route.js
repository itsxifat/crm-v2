export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer, Timesheet, Agreement, Document, SalaryPayout, FreelancerAssignment } from '@/models'
import { requireStaff, requirePerm } from '@/lib/rbac'
import { maskDoc, FREELANCER_PII } from '@/lib/pii'
import { computeFreelancerFinance } from '@/lib/freelancerBalance'
import { z } from 'zod'

const updateSchema = z.object({
  name:        z.string().min(1).optional(),
  phone:       z.string().optional().nullable(),
  skills:      z.string().optional().nullable(),
  bio:         z.string().optional().nullable(),
  // Default currency we pay this person in (per-engagement currency overrides this)
  paymentCurrency: z.string().optional(),
  // Engagement model + salary settings (temporary salary-based freelancer)
  employmentMode:  z.enum(['PROJECT', 'SALARY']).optional(),
  salaryAmount:    z.number().positive().optional().nullable(),
  salaryCurrency:  z.string().optional(),
  salaryDay:       z.number().int().min(1).max(28).optional().nullable(),
  salaryStartDate: z.string().optional().nullable(),
  salaryEndDate:   z.string().optional().nullable(),
  salaryActive:    z.boolean().optional(),
})

// GET /api/freelancers/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)   // exposes bank/payment details — staff only
    if (denied) return denied

    await connectDB()

    const freelancer = await Freelancer.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive lastLogin createdAt' })

    if (!freelancer) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

    const [assignments, salaryPayouts, timesheets, agreements, documents, finance] = await Promise.all([
      FreelancerAssignment.find({ freelancerId: params.id }).sort({ createdAt: -1 })
        .populate({ path: 'projectId', select: 'id name projectCode venture status' }),
      SalaryPayout.find({ freelancerId: params.id }).sort({ period: -1 }),
      Timesheet.find({ freelancerId: params.id }).sort({ date: -1 }).limit(50)
        .populate({ path: 'taskId', select: 'id title', populate: { path: 'projectId', select: 'name' } }),
      Agreement.find({ freelancerId: params.id }).sort({ createdAt: -1 }),
      Document.find({ freelancerId: params.id }).sort({ createdAt: -1 }),
      computeFreelancerFinance(params.id),
    ])

    return NextResponse.json({
      data: maskDoc(session, {
        ...freelancer.toJSON(),
        // `documents` below is the separate Document collection; expose the
        // freelancer's own KYC uploads under a distinct key so it isn't clobbered.
        kycDocuments: freelancer.documents ?? [],
        assignments, salaryPayouts, timesheets, agreements, documents, finance,
      }, FREELANCER_PII),
    })
  } catch (err) {
    console.error('[GET /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/freelancers/[id] — edit profile / engagement / salary settings
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.freelancers.manage')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { name, phone, ...freelancerData } = parsed.data

    // Normalise empty date strings to null so Mongoose doesn't choke casting ''.
    if (freelancerData.salaryStartDate === '') freelancerData.salaryStartDate = null
    if (freelancerData.salaryEndDate === '')   freelancerData.salaryEndDate = null

    const freelancer = await Freelancer.findById(params.id).lean()
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await Promise.all([
      Freelancer.findByIdAndUpdate(params.id, freelancerData),
      User.findByIdAndUpdate(freelancer.userId, {
        ...(name  && { name }),
        ...(phone !== undefined && { phone }),
      }),
    ])

    const updated = await Freelancer.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PUT /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/freelancers/[id] — enable / disable account.
// Disabling is blocked while the freelancer is owed money for delivered work or
// has a pending salary payout.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.freelancers.manage')
    if (denied) return denied

    await connectDB()

    const { action, reason } = await request.json()
    if (!['disable', 'enable'].includes(action)) {
      return NextResponse.json({ error: 'action must be "disable" or "enable"' }, { status: 422 })
    }

    const freelancer = await Freelancer.findById(params.id)
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (action === 'disable') {
      const finance = await computeFreelancerFinance(params.id)
      if (finance.hasUnpaid) {
        return NextResponse.json({
          error: 'Cannot disable: this freelancer is still owed payment. Settle all dues first.',
          owed: finance.owed,
        }, { status: 409 })
      }
      freelancer.disabledAt     = new Date()
      freelancer.disabledBy     = session.user.id
      freelancer.disabledReason = reason ?? null
      await Promise.all([
        freelancer.save(),
        User.findByIdAndUpdate(freelancer.userId, { isActive: false }),
      ])
    } else {
      freelancer.disabledAt     = null
      freelancer.disabledBy     = null
      freelancer.disabledReason = null
      await Promise.all([
        freelancer.save(),
        User.findByIdAndUpdate(freelancer.userId, { isActive: true }),
      ])
    }

    const updated = await Freelancer.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PATCH /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/freelancers/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const freelancer = await Freelancer.findById(params.id).lean()
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Don't delete someone who is still owed money.
    const finance = await computeFreelancerFinance(params.id)
    if (finance.hasUnpaid) {
      return NextResponse.json({ error: 'Cannot delete: outstanding payment owed.' }, { status: 409 })
    }

    await User.findByIdAndDelete(freelancer.userId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
