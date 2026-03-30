import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Client, Project, Invoice, Agreement, Document } from '@/models'

// GET /api/clients/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const client = await Client.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive lastLogin createdAt' })
      .populate({ path: 'parentClientId', select: 'id clientCode company clientType', populate: { path: 'userId', select: 'name' } })
      .populate('kyc.reviewedBy', 'name')

    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Linked companies — all other Client records sharing the same userId
    const linkedClients = await Client.find({
      userId:  client.userId._id,
      _id:     { $ne: client._id },
    }).select('id clientCode clientType company industry priority createdAt').lean()

    const [projects, invoices, documents, agreements] = await Promise.all([
      Project.find({ clientId: params.id }).sort({ createdAt: -1 }),
      Invoice.find({ clientId: params.id }).sort({ createdAt: -1 }),
      Document.find({ clientId: params.id }).sort({ createdAt: -1 }),
      Agreement.find({ clientId: params.id }).sort({ createdAt: -1 }),
    ])

    const totalRevenue       = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + i.total, 0)
    const outstandingBalance = invoices.filter(i => ['SENT','PARTIALLY_PAID','OVERDUE'].includes(i.status)).reduce((s, i) => s + i.total, 0)
    const activeProjectCount = projects.filter(p => ['IN_PROGRESS','ACTIVE'].includes(p.status)).length

    return NextResponse.json({
      data: {
        ...client.toJSON(),
        linkedClients,
        projects:   projects.map(p => p.toJSON()),
        invoices:   invoices.map(i => i.toJSON()),
        documents:  documents.map(d => d.toJSON()),
        agreements: agreements.map(a => a.toJSON()),
        totalRevenue,
        outstandingBalance,
        activeProjectCount,
      },
    })
  } catch (err) {
    console.error('[GET /api/clients/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/clients/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const body = await request.json()
    const { name, email, phone, isActive, ...clientData } = body

    const current = await Client.findById(params.id)
    if (!current) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const userUpdate = {}
    if (name     !== undefined) userUpdate.name     = name
    if (email    !== undefined) userUpdate.email    = email
    if (phone    !== undefined) userUpdate.phone    = phone
    if (isActive !== undefined) userUpdate.isActive = isActive

    // Remove KYC status fields from general PUT — use the dedicated KYC endpoint
    delete clientData['kyc.status']
    delete clientData['kyc.remarks']
    delete clientData['kyc.reviewedBy']
    delete clientData['kyc.reviewedAt']

    await Promise.all([
      Object.keys(userUpdate).length > 0
        ? User.findByIdAndUpdate(current.userId, userUpdate)
        : Promise.resolve(),
      Client.findByIdAndUpdate(params.id, clientData, { runValidators: false }),
    ])

    const updated = await Client.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })
      .populate('kyc.reviewedBy', 'name')

    return NextResponse.json({ data: updated.toJSON() })
  } catch (err) {
    console.error('[PUT /api/clients/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/clients/[id] — soft delete
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const client = await Client.findById(params.id).lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    await User.findByIdAndUpdate(client.userId, { isActive: false })
    return NextResponse.json({ success: true, message: 'Client deactivated' })
  } catch (err) {
    console.error('[DELETE /api/clients/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
