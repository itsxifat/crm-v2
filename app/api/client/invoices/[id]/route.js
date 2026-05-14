export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, Invoice } from '@/models'

export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const clients = await Client.find({ userId: session.user.id })
      .select('_id clientCode company')
      .lean()
    if (!clients.length) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const clientIds = clients.map(c => c._id)
    const clientMap = Object.fromEntries(
      clients.map(c => [c._id.toString(), { clientCode: c.clientCode, company: c.company }])
    )

    const invoice = await Invoice.findOne({
      _id: params.id,
      clientId: { $in: clientIds },
      status: { $ne: 'DRAFT' },
    })
      .populate('projectId', 'name projectCode')
      .lean()

    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      data: {
        ...invoice,
        id: invoice._id.toString(),
        clientInfo: clientMap[invoice.clientId?.toString()] ?? null,
      },
    })
  } catch (err) {
    console.error('[GET /api/client/invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
