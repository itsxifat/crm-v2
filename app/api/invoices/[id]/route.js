export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, INVOICE_PII } from '@/lib/pii'

async function getPopulated(id) {
  return Invoice.findById(id)
    .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email avatar phone' } })
    .populate('projectId',  'name projectCode venture category')
    .populate('createdBy', 'name')
}

export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.view')   // admin view; clients use /api/client/invoices
    if (denied) return denied
    await connectDB()
    const invoice = await getPopulated(params.id)
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Auto-transition to OVERDUE when past due date
    if (['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && invoice.dueDate && invoice.dueDate < new Date()) {
      invoice.status = 'OVERDUE'
      await invoice.save()
    }

    return NextResponse.json({ data: maskDoc(session, invoice.toJSON(), INVOICE_PII) })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.invoices.update')
    if (denied) return denied
    await connectDB()

    const body = await request.json()
    const { items, issueDate, dueDate, taxRate, discount, ...rest } = body

    const processedItems = (items ?? []).map(item => ({
      description: item.description,
      quantity:    Number(item.quantity) || 1,
      rate:        Number(item.rate)     || 0,
      amount:      (Number(item.quantity) || 1) * (Number(item.rate) || 0),
    }))
    const subtotal = Math.round(processedItems.reduce((s, i) => s + i.amount, 0) * 100) / 100
    const taxAmt   = Math.round(subtotal * ((Number(taxRate) || 0) / 100) * 100) / 100
    const total    = Math.round((subtotal + taxAmt - (Number(discount) || 0)) * 100) / 100

    const invoice = await Invoice.findByIdAndUpdate(
      params.id,
      {
        ...rest,
        items:     processedItems,
        issueDate: issueDate ? new Date(issueDate) : undefined,
        dueDate:   dueDate   ? new Date(dueDate)   : null,
        subtotal, taxRate: Number(taxRate) || 0, taxAmount: taxAmt,
        discount: Number(discount) || 0, total,
      },
      { new: true, runValidators: true }
    )
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await invoice.populate([
      { path: 'clientId',  populate: { path: 'userId', select: 'name email avatar' } },
      { path: 'projectId', select: 'name projectCode venture category' },
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({ total: invoice.total, status: invoice.status }),
      request,
    })

    return NextResponse.json({ data: invoice.toJSON() })
  } catch (err) {
    console.error('[PUT /api/invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.invoices.delete')
    if (denied) return denied
    await connectDB()
    const invoice = await Invoice.findByIdAndDelete(params.id)
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({ invoiceNumber: invoice.invoiceNumber }),
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
