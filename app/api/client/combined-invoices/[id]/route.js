export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CombinedInvoice } from '@/models'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { buildCombined } from '@/lib/combinedInvoice'

// GET /api/client/combined-invoices/:id
// Same live rollup the admin sees. DRAFT children are excluded by
// buildCombined() for everyone, so the client's figures match the admin's.
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const clientIds = await getMyCompanyIds(session.user.id)
    if (!clientIds.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const doc = await CombinedInvoice.findOne({ _id: params.id, clientId: { $in: clientIds } })
      .populate('projectId', 'name projectCode venture category')
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email phone' } })

    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: await buildCombined(doc) })
  } catch (err) {
    console.error('[GET /api/client/combined-invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
