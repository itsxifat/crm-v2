export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, Document } from '@/models'

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const client = await Client.findOne({ userId: session.user.id }).lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const search   = searchParams.get('search')
    const page     = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit    = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip     = (page - 1) * limit

    const filter = { clientId: client._id }
    if (category && category !== 'ALL') filter.category = category
    if (search) filter.name = { $regex: search, $options: 'i' }

    const [documents, total] = await Promise.all([
      Document.find(filter)
        .populate('projectId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Document.countDocuments(filter),
    ])

    return NextResponse.json({
      documents: documents.map(d => ({ ...d, id: d._id.toString() })),
      total,
      pages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error('[GET /api/client/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
