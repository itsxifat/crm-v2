export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Project, CombinedInvoice, Employee } from '@/models'
import { canAccess } from '@/lib/permissions'
import { requirePerm } from '@/lib/rbac'
import {
  buildCombined, ensureCombinedInvoice, findProjectInvoices,
  serialiseChild, rollUp, deriveStatus, toObjectId, NON_BILLABLE_STATUSES,
} from '@/lib/combinedInvoice'

// Financial visibility mirrors GET /api/projects/:id — an employee without the
// viewFinancials flag must not see invoice amounts via this back door.
async function canViewFinancials(session) {
  if (['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) return true
  if (session.user.role !== 'EMPLOYEE') return false
  const emp = await Employee.findOne({ userId: session.user.id })
    .populate({ path: 'customRoleId', select: 'permissions' })
    .lean()
  return emp?.customRoleId?.permissions?.projects?.viewFinancials === true
}

// GET /api/projects/:id/invoices
// Every invoice raised against the project, plus a live rollup and a pointer to
// the combined invoice (if the project has one).
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canAccess(session, 'invoices', 'read'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await canViewFinancials(session)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const project = await Project.findById(params.id).select('name projectCode venture budget discount paidAmount currency').lean()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Admin view shows drafts too, flagged as excluded from the rollup.
    const all      = await findProjectInvoices(params.id, { billableOnly: false })
    const children = all.map(serialiseChild)
    const billable = children.filter(c => !NON_BILLABLE_STATUSES.includes(c.status))
    const totals   = rollUp(billable)

    const combinedDoc = await CombinedInvoice.findOne({ projectId: toObjectId(params.id) })
      .select('combinedNumber projectId createdAt')
      .lean()

    return NextResponse.json({
      data: children,
      summary: {
        ...totals,
        allCount:     children.length,
        draftCount:   children.filter(c => c.status === 'DRAFT').length,
        cancelledCount: children.filter(c => c.status === 'CANCELLED').length,
        status:       deriveStatus(billable, totals),
        currency:     project.currency ?? 'BDT',
        projectBudget:   Number(project.budget ?? 0),
        projectDiscount: Number(project.discount ?? 0),
        // What the project is worth vs what has actually been invoiced — the
        // gap tells you how much of the contract is still un-billed.
        uninvoiced: Math.max(
          0,
          Math.round((Number(project.budget ?? 0) - Number(project.discount ?? 0) - totals.total) * 100) / 100
        ),
      },
      combined: combinedDoc
        ? { id: combinedDoc._id.toString(), combinedNumber: combinedDoc.combinedNumber, createdAt: combinedDoc.createdAt }
        : null,
      meta: { canCombine: billable.length >= 1 },
    })
  } catch (err) {
    console.error('[GET /api/projects/:id/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/:id/invoices — generate (or fetch) this project's combined invoice.
export async function POST(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.create')
    if (denied) return denied
    await connectDB()

    const count = await Invoice.countDocuments({
      $or: [{ projectId: toObjectId(params.id) }, { projectIds: toObjectId(params.id) }],
      status: { $ne: 'CANCELLED' },
    })
    if (count === 0)
      return NextResponse.json({ error: 'This project has no invoices to combine.' }, { status: 422 })

    const doc = await ensureCombinedInvoice(params.id, { createdBy: session.user.id, force: true })
    if (!doc) return NextResponse.json({ error: 'Could not create a combined invoice.' }, { status: 422 })

    await doc.populate([
      { path: 'projectId', select: 'name projectCode venture category' },
      { path: 'clientId',  populate: { path: 'userId', select: 'name email avatar' } },
    ])

    return NextResponse.json({ data: await buildCombined(doc) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/:id/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
