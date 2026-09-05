export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, CombinedInvoice } from '@/models'
import { getMyCompanyIds } from '@/lib/clientAccess'
import {
  findProjectInvoices, serialiseChild, rollUp, deriveStatus, toObjectId,
} from '@/lib/combinedInvoice'

// GET /api/client/projects/:id/invoices
// Issued invoices for one of the caller's projects, plus the live rollup and a
// link to the combined invoice when the project has more than one.
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const clientIds = await getMyCompanyIds(session.user.id)
    if (!clientIds.length) return NextResponse.json({ data: [], summary: null, combined: null })

    const project = await Project.findOne({ _id: params.id, clientId: { $in: clientIds } })
      .select('_id name projectCode currency')
      .lean()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // billableOnly drops DRAFT + CANCELLED — clients never see unissued invoices.
    const invoices = await findProjectInvoices(project._id, { billableOnly: true })
    const children = invoices.map(serialiseChild)
    const totals   = rollUp(children)

    const combined = await CombinedInvoice.findOne({ projectId: toObjectId(project._id) })
      .select('combinedNumber')
      .lean()

    return NextResponse.json({
      data: children.map(({ items, ...rest }) => rest),
      summary: { ...totals, status: deriveStatus(children, totals), currency: project.currency ?? 'BDT' },
      combined: combined && children.length > 1
        ? { id: combined._id.toString(), combinedNumber: combined.combinedNumber }
        : null,
      project: { id: project._id.toString(), name: project.name, projectCode: project.projectCode },
    })
  } catch (err) {
    console.error('[GET /api/client/projects/:id/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
