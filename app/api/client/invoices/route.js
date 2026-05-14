export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, Invoice } from '@/models'

export async function GET(request) {
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip   = (page - 1) * limit

    const filter = { clientId: { $in: clientIds }, status: { $ne: 'DRAFT' } }
    if (status && status !== 'ALL') filter.status = status

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('projectId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(filter),
    ])

    return NextResponse.json({
      invoices: invoices.map(i => ({
        ...i,
        id: i._id.toString(),
        clientInfo: clientMap[i.clientId?.toString()] ?? null,
      })),
      total,
      pages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error('[GET /api/client/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
