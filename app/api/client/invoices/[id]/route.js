export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, CombinedInvoice } from '@/models'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { toObjectId } from '@/lib/combinedInvoice'

export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const clientIds = await getMyCompanyIds(session.user.id)
    if (!clientIds.length) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // NOTE: hydrated (non-lean) query so the populated Client/Invoice decryption
    // hooks run — otherwise encrypted fields (company, address, items, totals…)
    // come back as ciphertext. toJSON() then yields fully-decrypted plain data,
    // mirroring the admin invoice route so both render the same InvoicePrintView.
    const invoice = await Invoice.findOne({
      _id: params.id,
      clientId: { $in: clientIds },
      status: { $ne: 'DRAFT' },
    })
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email phone' } })
      .populate('projectId',  'name projectCode venture category')
      .populate('projectIds', 'name projectCode venture category')

    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Link to the project's combined invoice when there is more than one issued
    // invoice on it.
    const projectId = invoice.projectId?._id ?? invoice.projectId ?? invoice.projectIds?.[0]?._id ?? null
    let combined = null
    if (projectId) {
      const [cmb, siblingCount] = await Promise.all([
        CombinedInvoice.findOne({ projectId: toObjectId(projectId), clientId: { $in: clientIds } })
          .select('combinedNumber').lean(),
        Invoice.countDocuments({
          $or: [{ projectId: toObjectId(projectId) }, { projectIds: toObjectId(projectId) }],
          clientId: { $in: clientIds },
          status: { $nin: ['DRAFT', 'CANCELLED'] },
        }),
      ])
      if (cmb && siblingCount > 1) combined = { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber }
    }

    return NextResponse.json({ data: invoice.toJSON(), combined })
  } catch (err) {
    console.error('[GET /api/client/invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
