export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Project, CombinedInvoice } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { canAccessProject, canViewProjectFinancials } from '@/lib/projectAccess'
import { maskDoc, INVOICE_PII } from '@/lib/pii'
import {
  buildCombined, ensureCombinedInvoice, findProjectInvoices,
  serialiseChild, rollUp, deriveStatus, toObjectId, NON_BILLABLE_STATUSES,
} from '@/lib/combinedInvoice'

// Financial visibility mirrors GET /api/projects/:id (lib/projectAccess) — a
// user without project financial visibility must not see invoice amounts via
// this back door.

// GET /api/projects/:id/invoices
// Every invoice raised against the project, plus a live rollup and a pointer to
// the combined invoice (if the project has one).
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.view')
    if (denied) return denied
    if (!canViewProjectFinancials(session))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    await connectDB()

    const project = await Project.findById(params.id).select('name projectCode venture budget paidAmount currency').lean()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!(await canAccessProject(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
        projectValue: Number(project.budget ?? 0),
        // What the project is worth vs what has actually been invoiced — the
        // gap tells you how much of the project value is still un-billed.
        uninvoiced: Math.max(
          0,
          Math.round((Number(project.budget ?? 0) - totals.total) * 100) / 100
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
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
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

    return NextResponse.json({ data: maskDoc(session, await buildCombined(doc), INVOICE_PII) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/:id/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
