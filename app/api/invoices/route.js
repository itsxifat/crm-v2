export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Client } from '@/models'
import { logActivity } from '@/lib/logActivity'
import mongoose from 'mongoose'

// Helper: build a filter that matches a projectId in EITHER the new singular
// field OR the legacy projectIds array (backward compat)
function projectFilter(projectId) {
  return { $or: [{ projectId }, { projectIds: projectId }] }
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit') ?? '20', 10)
    const status    = searchParams.get('status')
    const clientId  = searchParams.get('clientId')
    const projectId = searchParams.get('projectId')
    const skip      = (page - 1) * limit

    const filter = {}
    if (status)   filter.status   = status
    if (clientId) filter.clientId = clientId
    // Match both new (projectId) and old (projectIds array) styles
    if (projectId) {
      try {
        const oid = new mongoose.Types.ObjectId(projectId)
        filter.$or = [{ projectId: oid }, { projectIds: oid }]
      } catch {
        filter.$or = [{ projectId }, { projectIds: projectId }]
      }
    }

    // CLIENT role: only see their invoices
    if (session.user.role === 'CLIENT') {
      const client = await Client.findOne({ userId: session.user.id }).lean()
      if (client) filter.clientId = client._id
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .skip(skip).limit(limit).sort({ createdAt: -1 })
        .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email avatar' } })
        .populate('projectId',  'name projectCode venture')
        .populate('projectIds', 'name projectCode venture')
        .populate('createdBy', 'name'),
      Invoice.countDocuments(filter),
    ])

    return NextResponse.json({
      data: invoices.map(i => i.toJSON()),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const body = await request.json()
    const { clientId, projectId, items, issueDate, dueDate, taxRate, discount, notes, terms, currency } = body

    if (!clientId) return NextResponse.json({ error: 'Client required' }, { status: 422 })
    if (!items || items.length === 0) return NextResponse.json({ error: 'At least one item required' }, { status: 422 })

    // Enforce 1 invoice per project — check BOTH old and new storage formats
    if (projectId) {
      let oid
      try { oid = new mongoose.Types.ObjectId(projectId) } catch { oid = projectId }
      const existing = await Invoice.findOne({
        $or: [{ projectId: oid }, { projectIds: oid }],
      }).lean()
      if (existing) {
        return NextResponse.json({
          error: 'An invoice already exists for this project. Open the existing invoice to add more items.',
          existingInvoiceId: existing._id.toString(),
        }, { status: 409 })
      }
    }

    // Recalculate totals server-side
    const processedItems = items.map(item => ({
      description: item.description,
      quantity:    Number(item.quantity) || 1,
      rate:        Number(item.rate)     || 0,
      amount:      (Number(item.quantity) || 1) * (Number(item.rate) || 0),
    }))
    const subtotal  = processedItems.reduce((s, i) => s + i.amount, 0)
    const taxAmt    = subtotal * ((Number(taxRate) || 0) / 100)
    const total     = subtotal + taxAmt - (Number(discount) || 0)

    const invoice = await new Invoice({
      clientId,
      projectId:   projectId || null,
      items:       processedItems,
      issueDate:   issueDate ? new Date(issueDate) : new Date(),
      dueDate:     dueDate   ? new Date(dueDate)   : null,
      subtotal,
      taxRate:     Number(taxRate)   || 0,
      taxAmount:   taxAmt,
      discount:    Number(discount)  || 0,
      total,
      currency:    currency ?? 'BDT',
      notes:       notes || null,
      terms:       terms || null,
      createdBy:   session.user.id,
    }).save()

    await invoice.populate([
      { path: 'clientId',  populate: { path: 'userId', select: 'name email avatar' } },
      { path: 'projectId', select: 'name projectCode venture' },
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'INVOICE',
      entityId: invoice._id.toString(),
      changes:  JSON.stringify({ invoiceNumber: invoice.invoiceNumber, total: invoice.total, currency: invoice.currency }),
      request,
    })

    return NextResponse.json({ data: invoice.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
