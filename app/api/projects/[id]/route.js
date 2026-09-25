export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import {
  Project, ProjectExpense, ProjectRenewal, Task, Milestone, Invoice,
  ProjectPayment, CombinedInvoice, FreelancerAssignment, ProjectDiscussion, ProjectVendor,
} from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { canAccessProject, canViewProjectFinancials } from '@/lib/projectAccess'
import mongoose from 'mongoose'

// Only the client fields the project UI needs — never the client's KYC,
// VAT, address or contact PII (those live behind the masked clients API).
const CLIENT_POPULATE = {
  path: 'clientId',
  select: 'userId clientCode clientType company contactPerson',
  populate: { path: 'userId', select: 'name avatar' },
}

// GET /api/projects/:id
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const project = await Project.findById(params.id)
      .populate(CLIENT_POPULATE)
      .populate('projectManagerId', 'name avatar')
      .populate('teamMembers', 'name avatar')

    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await canAccessProject(session, project)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const canViewFinancials = canViewProjectFinancials(session)

    const [expenses, renewals, tasks, milestones] = await Promise.all([
      canViewFinancials
        ? ProjectExpense.find({ projectId: params.id }).sort({ createdAt: -1 })
            .populate('submittedBy', 'name avatar')
            .populate('reviewedBy', 'name')
        : Promise.resolve([]),
      ProjectRenewal.find({ projectId: params.id }).sort({ periodStart: -1 }),
      Task.find({ projectId: params.id }).sort({ createdAt: -1 }),
      Milestone.find({ projectId: params.id }).sort({ dueDate: 1 }),
    ])

    const data = project.toJSON()
    data.tasks      = tasks.map(t => t.toJSON())
    data.renewals   = renewals.map(r => r.toJSON())
    data.milestones = milestones.map(m => m.toJSON())

    if (canViewFinancials) {
      data.profit            = (data.paidAmount ?? 0) - (data.approvedExpenses ?? 0)
      data.contractedProfit  = (data.budget ?? 0) - (data.approvedExpenses ?? 0)
      data.dueAmount         = Math.max(0, (data.budget ?? 0) - (data.paidAmount ?? 0))
      data.expenses          = expenses.map(e => e.toJSON())
    } else {
      // Strip all financial fields — never expose pricing to unpermitted users
      delete data.budget
      delete data.paidAmount
      delete data.approvedExpenses
      delete data.profit
      delete data.dueAmount
      delete data.budgetUtilization
      data.expenses = []
      // Renewal rows carry the recurring project value — keep the history, drop the money.
      data.renewals = data.renewals.map(({ billingAmount, discountApplied, ...r }) => r)
    }

    return NextResponse.json({ data, meta: { canViewFinancials } })
  } catch (err) {
    console.error('[GET /api/projects/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/projects/:id
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const body = await request.json()
    delete body.orderDate  // immutable

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Capture pre-update values to detect what changed
    const prevDeadline     = project.deadline?.toISOString().slice(0, 10) ?? null
    const prevDeadlineTime = project.deadline ? new Date(project.deadline).getTime() : null

    // The lifecycle (FIXED deadline vs MONTHLY billing periods and statuses) is
    // fixed at creation — switching it here would leave the period fields and
    // status inconsistent.
    if (body.projectType !== undefined && body.projectType !== project.projectType) {
      return NextResponse.json({ error: 'Project type cannot be changed after creation' }, { status: 422 })
    }

    // Re-homing a project to another client would leave its invoices and
    // payments billed to the old company while the new company's portal sees
    // them through the project. Only allow it while nothing has been billed.
    if (body.clientId !== undefined && String(body.clientId ?? '') !== String(project.clientId ?? '')) {
      if (!isValidObjectId(body.clientId)) return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
      const pidObj = project._id
      const [hasInvoice, hasPayment, hasCombined] = await Promise.all([
        Invoice.exists({ $or: [{ projectId: pidObj }, { projectIds: pidObj }] }),
        ProjectPayment.exists({ projectId: pidObj }),
        CombinedInvoice.exists({ projectId: pidObj }),
      ])
      if (hasInvoice || hasPayment || hasCombined) {
        return NextResponse.json({
          error: 'The client cannot be changed on a project that already has invoices or payments',
        }, { status: 409 })
      }
    }

    // Monthly retainers have billing periods, not a deadline.
    if (project.projectType === 'MONTHLY') body.deadline = null

    // Apply allowed fields via read-modify-save so encryption hooks fire correctly.
    // Status is not editable here — it goes through PATCH /:id/status (state
    // machine + cancel bookkeeping) or POST /:id/renew.
    const ALLOWED = ['name','description','clientId','venture','category','subcategory',
      'projectManagerId','priority','startDate','deadline',
      'budget','currency','tags']

    // Legacy `discount` (dropped from the schema, folded into budget by
    // scripts/migrate-drop-project-discount.js). Until that migration has run,
    // a budget that differs from the stored gross value was entered as the NET
    // project value — drop the legacy discount so the migration does not
    // subtract it a second time. An unchanged budget keeps it for the migration.
    const legacy = await Project.collection.findOne(
      { _id: project._id },
      { projection: { budget: 1, discount: 1 } }
    )
    const legacyDiscount = Number(legacy?.discount) || 0
    const dropLegacyDiscount = legacyDiscount > 0 && body.budget !== undefined &&
      Math.round(Number(body.budget) * 100) !== Math.round((Number(legacy?.budget) || 0) * 100)

    for (const field of ALLOWED) {
      if (body[field] !== undefined) {
        if (field === 'startDate' || field === 'deadline') {
          project[field] = body[field] ? new Date(body[field]) : null
        } else {
          project[field] = body[field]
        }
      }
    }
    await project.save()
    if (dropLegacyDiscount) {
      await Project.collection.updateOne({ _id: project._id }, { $unset: { discount: '' } })
    }

    await project.populate([
      CLIENT_POPULATE,
      { path: 'projectManagerId', select: 'name avatar' },
    ])

    const pid         = new mongoose.Types.ObjectId(params.id)
    const newDeadline = project.deadline?.toISOString().slice(0, 10) ?? null

    // A new deadline moves the due date only on still-open invoices that were
    // following the project deadline (due date equal to the old deadline, or
    // unset). Invoices with their own phase/milestone due dates keep them.
    // Amounts are never pushed down from the project.
    if (newDeadline !== prevDeadline && newDeadline !== null) {
      const newDue = new Date(project.deadline)
      const open = await Invoice.find({
        $or: [{ projectId: pid }, { projectIds: pid }],
        status: { $nin: ['PAID', 'CANCELLED'] },
      }).select('status dueDate paidAmount').lean()

      const ops = open
        .filter(inv => !inv.dueDate || new Date(inv.dueDate).getTime() === prevDeadlineTime)
        .map(inv => {
          const $set = { dueDate: newDue }
          // Mirrors the invoice auto-overdue rule (dueDate < now): moving the due
          // date into the future lifts OVERDUE back to its open state.
          if (inv.status === 'OVERDUE' && newDue > new Date()) {
            $set.status = Number(inv.paidAmount ?? 0) > 0 ? 'PARTIALLY_PAID' : 'SENT'
          }
          return { updateOne: { filter: { _id: inv._id, status: inv.status }, update: { $set } } }
        })
      if (ops.length) await Invoice.bulkWrite(ops)
    }

    const data = project.toJSON()
    if (canViewProjectFinancials(session)) {
      data.profit           = (data.paidAmount ?? 0) - (data.approvedExpenses ?? 0)
      data.contractedProfit = (data.budget ?? 0) - (data.approvedExpenses ?? 0)
      data.dueAmount        = Math.max(0, (data.budget ?? 0) - (data.paidAmount ?? 0))
    } else {
      for (const k of ['budget', 'paidAmount', 'approvedExpenses', 'profit', 'dueAmount', 'budgetUtilization']) delete data[k]
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'PROJECT',
      entityId: params.id,
      changes:  JSON.stringify({ name: project.name, status: project.status }),
      request,
    })

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[PUT /api/projects/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/:id
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const existing = await Project.findById(params.id).select('_id').lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Refuse to hard-delete a project that carries money or engagements —
    // deleting it would orphan invoices/payments/ledger rows and strand
    // freelancer assignments. Cancel it instead.
    const pid = existing._id
    const [invoices, payments, combined, assignments, liveExpenses] = await Promise.all([
      Invoice.exists({ $or: [{ projectId: pid }, { projectIds: pid }] }),
      ProjectPayment.exists({ projectId: pid }),
      CombinedInvoice.exists({ projectId: pid }),
      FreelancerAssignment.exists({ projectId: pid }),
      ProjectExpense.exists({ projectId: pid, status: { $ne: 'REJECTED' } }),
    ])
    if (invoices || payments || combined || assignments || liveExpenses) {
      return NextResponse.json({
        error: 'This project has invoices, payments, expenses or freelancer assignments and cannot be deleted. Cancel it instead.',
      }, { status: 409 })
    }

    const project = await Project.findByIdAndDelete(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await Promise.all([
      ProjectExpense.deleteMany({ projectId: params.id }),
      ProjectRenewal.deleteMany({ projectId: params.id }),
      Task.deleteMany({ projectId: params.id }),
      Milestone.deleteMany({ projectId: params.id }),
      ProjectDiscussion.deleteMany({ projectId: params.id }),
      ProjectVendor.deleteMany({ projectId: params.id }),
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'PROJECT',
      entityId: params.id,
      changes:  JSON.stringify({ name: project.name }),
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/projects/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
