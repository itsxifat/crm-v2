export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer, Timesheet, Agreement, Document, SalaryPayout, FreelancerAssignment } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { maskDoc, FREELANCER_PII, restoreMaskedValues } from '@/lib/pii'
import { computeFreelancerFinance } from '@/lib/freelancerBalance'
import { calcFreelancerProfileCompletion } from '@/models/Freelancer'
import { logActivity } from '@/lib/logActivity'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'
import { z } from 'zod'

// ── Tax identity (payee side of TDS / VDS). Blank ⇒ null. ───────────────────
const TAX_FIELDS = ['tin', 'bin', 'payeeType', 'hasPsr']
const binField = z.preprocess(
  v => (typeof v === 'string' ? (v.replace(/\s+/g, '') || null) : v),
  z.string().regex(BIN_REGEX, 'BIN must be 9 or 13 digits, e.g. 000123456-0101')
    .transform(s => normalizeBin(s) || s).nullable().optional(),
)
const tinField = z.preprocess(
  v => (typeof v === 'string' ? (v.replace(/[\s-]+/g, '') || null) : v),
  z.string().regex(TIN_REGEX, 'TIN must be the 12-digit e-TIN').nullable().optional(),
)

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
  // Agency profile (merged into the stored sub-documents; email is not editable here —
  // it is the login identity).
  agencyInfo: z.object({
    agencyName: z.string().min(1).optional(),
    phone:      z.string().optional().nullable(),
    address:    z.string().optional().nullable(),
    type:       z.string().optional().nullable(),
  }).optional(),
  contactPerson: z.object({
    name:        z.string().optional().nullable(),
    phone:       z.string().optional().nullable(),
    email:       z.string().email().optional().nullable().or(z.literal('')),
    designation: z.string().optional().nullable(),
  }).optional(),
  // Tax identity — drives the TDS rate (company vs individual vs non-resident)
  // and the 50% uplift when no proof of return submission (PSR) is produced.
  tin:       tinField,
  bin:       binField,
  payeeType: z.preprocess(
    v => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    z.enum(['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT']).optional(),
  ),
  hasPsr:    z.boolean().optional(),
})

// Agencies are managed under hr.agencies.manage, individual freelancers under
// hr.freelancers.manage (both share this API).
function requireTypePerm(session, type) {
  return requirePerm(session, type === 'AGENCY' ? 'hr.agencies.manage' : 'hr.freelancers.manage')
}

// Staff check + load the record's type, then the type-specific permission.
// Returns { denied } or { type }.
async function guardFreelancer(session, id) {
  const notStaff = requireStaff(session)
  if (notStaff) return { denied: notStaff }
  if (!isValidObjectId(id)) return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  await connectDB()
  const rec = await Freelancer.findById(id).select('type').lean()
  if (!rec) return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const denied = requireTypePerm(session, rec.type)
  return denied ? { denied } : { type: rec.type }
}

// GET /api/freelancers/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    // Exposes engagement amounts, owed/paid finance and (masked) bank details —
    // freelancer (or, for agencies, agency) managers only.
    const { denied } = await guardFreelancer(session, params.id)
    if (denied) return denied

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
        kycDocuments: (freelancer.documents ?? []).map(d => (d?.toJSON ? d.toJSON() : { ...d })),
        // Plain objects so FREELANCER_PII can mask payout amounts.
        salaryPayouts: salaryPayouts.map(p => p.toJSON()),
        assignments, timesheets, agreements, documents, finance,
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
    const { denied } = await guardFreelancer(session, params.id)
    if (denied) return denied

    const freelancer = await Freelancer.findById(params.id).lean()
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Never write masked PII placeholders back — restore the stored value
    // (phone lives on User, so a masked phone is simply dropped).
    const body   = restoreMaskedValues(await request.json(), freelancer)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { name, phone, agencyInfo, contactPerson, ...freelancerData } = parsed.data

    // Merge agency / contact sub-fields individually so omitted keys are kept.
    if (agencyInfo && freelancer.type === 'AGENCY') {
      for (const [k, v] of Object.entries(agencyInfo)) {
        if (v !== undefined) freelancerData[`agencyInfo.${k}`] = v || null
      }
    }
    if (contactPerson) {
      for (const [k, v] of Object.entries(contactPerson)) {
        if (v !== undefined) freelancerData[`contactPerson.${k}`] = v || null
      }
    }

    // Normalise empty date strings to null so Mongoose doesn't choke casting ''.
    if (freelancerData.salaryStartDate === '') freelancerData.salaryStartDate = null
    if (freelancerData.salaryEndDate === '')   freelancerData.salaryEndDate = null

    await Promise.all([
      Freelancer.findByIdAndUpdate(params.id, freelancerData),
      User.findByIdAndUpdate(freelancer.userId, {
        ...(name  && { name }),
        ...(phone !== undefined && { phone }),
      }),
    ])

    // Agency / contact fields feed the KYC completion score — keep it in sync.
    if (agencyInfo || contactPerson) {
      const fresh = await Freelancer.findById(params.id).lean()
      await Freelancer.updateOne({ _id: params.id }, { profileCompletionPct: calcFreelancerProfileCompletion(fresh) })
    }

    const updated = await Freelancer.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })

    // Audit tax-identity edits (the e-TIN itself never goes to the log).
    const taxChanges = {}
    for (const k of TAX_FIELDS) {
      const v = parsed.data[k]
      if (v === undefined) continue
      const prev = freelancer[k] ?? null
      if (String(prev ?? '') !== String(v ?? '')) {
        taxChanges[k] = k === 'tin' ? (v ? 'updated' : 'cleared') : { from: prev, to: v }
      }
    }
    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'FREELANCER',
      entityId: params.id,
      changes:  JSON.stringify({
        fields: Object.keys(parsed.data),
        ...(Object.keys(taxChanges).length ? { tax: taxChanges } : {}),
      }),
      request,
    })

    return NextResponse.json({ data: maskDoc(session, updated.toJSON(), FREELANCER_PII) })
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
    const { denied } = await guardFreelancer(session, params.id)
    if (denied) return denied

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
    return NextResponse.json({ data: maskDoc(session, updated.toJSON(), FREELANCER_PII) })
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

    // Engagements still in flight must be completed or cancelled first
    // (or disable the account instead of deleting it).
    const openAssignments = await FreelancerAssignment.countDocuments({
      freelancerId: params.id,
      status: { $in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
    })
    if (openAssignments > 0) {
      return NextResponse.json({
        error: 'Cannot delete: this freelancer has active engagements. Complete or cancel them first, or disable the account instead.',
      }, { status: 409 })
    }

    // Remove the profile as well as the login, otherwise the orphaned
    // Freelancer row keeps being listed and (for SALARY mode) keeps getting
    // monthly payouts from the salary cron.
    await Promise.all([
      Freelancer.findByIdAndDelete(params.id),
      User.findByIdAndDelete(freelancer.userId),
    ])
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
