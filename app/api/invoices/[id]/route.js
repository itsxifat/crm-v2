export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, CombinedInvoice, ProjectPayment, Payment } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, INVOICE_PII } from '@/lib/pii'
import { toObjectId, projectInvoiceFilter } from '@/lib/combinedInvoice'
import { computeInvoiceTotals } from '@/lib/invoiceTotals'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDayStart } from '@/lib/dhakaTime'

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
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()
    const invoice = await getPopulated(params.id)
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Auto-transition to OVERDUE once the due DAY has passed. The due date is a
    // calendar day (stored as 00:00Z), so it only becomes overdue from the start
    // of the next Asia/Dhaka day, not from 06:00 on the day it is due.
    if (['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && invoice.dueDate && invoice.dueDate < dhakaDayStart()) {
      const res = await Invoice.updateOne(
        { _id: invoice._id, status: { $in: ['SENT', 'PARTIALLY_PAID'] } },
        { $set: { status: 'OVERDUE' } },
      )
      if (res.modifiedCount > 0) invoice.status = 'OVERDUE'
    }

    // Sibling context: how many invoices this project carries, and whether they
    // roll up into a combined invoice.
    const projectId = invoice.projectId?._id ?? invoice.projectId ?? invoice.projectIds?.[0] ?? null
    let combined = null
    let siblingCount = 0
    if (projectId) {
      const [cmb, count] = await Promise.all([
        CombinedInvoice.findOne({ projectId: toObjectId(projectId) }).select('combinedNumber').lean(),
        Invoice.countDocuments({ ...projectInvoiceFilter(projectId), status: { $ne: 'CANCELLED' } }),
      ])
      combined = cmb ? { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber } : null
      siblingCount = count
    }

    return NextResponse.json({
      data: maskDoc(session, invoice.toJSON(), INVOICE_PII),
      combined,
      meta: { projectInvoiceCount: siblingCount },
    })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.invoices.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const body = await request.json()
    // Whitelist: status / paidAmount / paidAt / invoiceNumber / createdBy etc.
    // are never writable here (payments go through Payment Confirmations).
    const { clientId, projectId, items, issueDate, dueDate, taxRate, discount, notes, terms, currency } = body ?? {}

    const existing = await Invoice.findById(params.id).select('status').lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Only drafts are editable: an issued invoice's totals are what the client
    // was billed and what payments were recorded against.
    if (existing.status !== 'DRAFT')
      return NextResponse.json({ error: `Only draft invoices can be edited (this one is ${existing.status})` }, { status: 409 })

    if (clientId !== undefined && !isValidObjectId(clientId))
      return NextResponse.json({ error: 'Invalid client' }, { status: 400 })
    if (projectId && !isValidObjectId(projectId))
      return NextResponse.json({ error: 'Invalid project' }, { status: 400 })

    const calc = computeInvoiceTotals({ items, taxRate, discount })
    if (calc.error) return NextResponse.json({ error: calc.error }, { status: 422 })

    const update = {
      items:     calc.items,
      subtotal:  calc.subtotal,
      taxRate:   calc.taxRate,
      taxAmount: calc.taxAmount,
      discount:  calc.discount,
      total:     calc.total,
      dueDate:   dueDate ? new Date(dueDate) : null,
    }
    if (issueDate)               update.issueDate = new Date(issueDate)
    if (clientId !== undefined)  update.clientId  = clientId
    if (projectId !== undefined) update.projectId = projectId || null
    if (notes !== undefined)     update.notes     = notes || null
    if (terms !== undefined)     update.terms     = terms || null
    if (currency)                update.currency  = String(currency)

    // Conditional on DRAFT so a concurrent send/cancel can't be overwritten
    const invoice = await Invoice.findOneAndUpdate(
      { _id: params.id, status: 'DRAFT' },
      { $set: update },
      { new: true, runValidators: true }
    )
    if (!invoice) return NextResponse.json({ error: 'Only draft invoices can be edited' }, { status: 409 })
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

export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.invoices.delete')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const existing = await Invoice.findById(params.id).select('status').lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Issued invoices are cancelled, never deleted: deleting would orphan their
    // payments / income records and drop billed amounts from the books.
    if (existing.status !== 'DRAFT')
      return NextResponse.json({ error: 'Only draft invoices can be deleted. Cancel an issued invoice instead.' }, { status: 409 })

    const [ppCount, legacyCount] = await Promise.all([
      ProjectPayment.countDocuments({ invoiceId: params.id }),
      Payment.countDocuments({ invoiceId: params.id }),
    ])
    if (ppCount + legacyCount > 0)
      return NextResponse.json({ error: 'This invoice has payments recorded against it and cannot be deleted.' }, { status: 409 })

    const invoice = await Invoice.findOneAndDelete({ _id: params.id, status: 'DRAFT' })
    if (!invoice) return NextResponse.json({ error: 'Only draft invoices can be deleted' }, { status: 409 })

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
