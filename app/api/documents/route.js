export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Document } from '@/models'

// GET /api/documents
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit') ?? '20', 10)
    const category  = searchParams.get('category')
    const search    = searchParams.get('search')
    const clientId  = searchParams.get('clientId')
    const projectId = searchParams.get('projectId')
    const skip      = (page - 1) * limit

    const filter = {}
    if (category)  filter.category  = category
    if (clientId)  filter.clientId  = clientId
    if (projectId) filter.projectId = projectId
    if (search)    filter.name      = { $regex: search, $options: 'i' }

    const [documents, total] = await Promise.all([
      Document.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate({ path: 'clientId',     populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'projectId', select: 'id name' })
        .populate({ path: 'freelancerId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'vendorId', select: 'id company' }),
      Document.countDocuments(filter),
    ])

    return NextResponse.json({
      data: documents,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/documents
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body = await request.json()
    const { name, description, fileUrl, fileSize, mimeType, category, projectId, clientId, freelancerId, vendorId } = body

    if (!name || !fileUrl) {
      return NextResponse.json({ error: 'name and fileUrl are required' }, { status: 422 })
    }

    const doc = await new Document({
      name,
      description,
      fileUrl,
      fileSize,
      mimeType,
      category,
      projectId:    projectId    || null,
      clientId:     clientId     || null,
      freelancerId: freelancerId || null,
      vendorId:     vendorId     || null,
      uploadedBy:   session.user.id,
    }).save()

    return NextResponse.json({ data: doc }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
