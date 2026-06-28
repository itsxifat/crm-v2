export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, CLIENT_PII } from '@/lib/pii'
import connectDB from '@/lib/mongodb'
import { User, Client, Project, Invoice, Agreement, Document } from '@/models'
import { logActivity } from '@/lib/logActivity'

// GET /api/clients/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.customers.view')
    if (denied) return denied
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
      data: maskDoc(session, {
        ...client.toJSON(),
        linkedClients,
        projects:   projects.map(p => p.toJSON()),
        invoices:   invoices.map(i => i.toJSON()),
        documents:  documents.map(d => d.toJSON()),
        agreements: agreements.map(a => a.toJSON()),
        totalRevenue,
        outstandingBalance,
        activeProjectCount,
      }, CLIENT_PII),
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
    const denied = requirePerm(session, 'sales.customers.update')
    if (denied) return denied
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

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'CLIENT',
      entityId: params.id,
      changes:  JSON.stringify({ clientCode: updated.clientCode, company: updated.company ?? null }),
      request,
    })

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
    const denied = requirePerm(session, 'sales.customers.delete')
    if (denied) return denied
    await connectDB()

    const client = await Client.findById(params.id).lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    await User.findByIdAndUpdate(client.userId, { isActive: false })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DEACTIVATE',
      entity:   'CLIENT',
      entityId: params.id,
      changes:  JSON.stringify({ clientCode: client.clientCode, isActive: false }),
      request,
    })

    return NextResponse.json({ success: true, message: 'Client deactivated' })
  } catch (err) {
    console.error('[DELETE /api/clients/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
