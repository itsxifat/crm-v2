export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import { Quotation } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { restoreMaskedValues } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'
import { QUOTATION_POPULATE, quotationJSON, computeQuotation } from '@/lib/quotation'

// GET /api/quotations/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.quotations.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const q = await Quotation.findById(params.id).populate(QUOTATION_POPULATE)
    if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: quotationJSON(session, q) })
  } catch (err) {
    console.error('[GET /api/quotations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/quotations/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.quotations.update')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const existing = await Quotation.findById(params.id).lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'DRAFT')
      return NextResponse.json({ error: 'Only draft quotations can be edited' }, { status: 409 })

    // The edit form is pre-filled from the masked GET response — put the real
    // values back for any placeholder that was posted unchanged.
    const body = restoreMaskedValues(await request.json(), existing) ?? {}
    const {
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items, issueDate, validUntil, taxRate = 0, discount = 0,
      notes, terms, currency, itemPriceOnly,
    } = body

    const calc = computeQuotation({ items, taxRate, discount })
    if (calc.error) return NextResponse.json({ error: calc.error }, { status: 422 })

    // Conditional on DRAFT so a concurrent status change can't be overwritten
    const q = await Quotation.findOneAndUpdate({ _id: params.id, status: 'DRAFT' }, {
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items: calc.items,
      issueDate:  issueDate  ? new Date(issueDate)  : undefined,
      validUntil: validUntil ? new Date(validUntil) : null,
      subtotal: calc.subtotal, taxRate: calc.taxRate, taxAmount: calc.taxAmount, discount: calc.discount, total: calc.total,
      ...(currency && { currency }),
      notes: notes ?? null, terms: terms ?? null,
      ...(itemPriceOnly !== undefined && { itemPriceOnly: !!itemPriceOnly }),
    }, { new: true }).populate(QUOTATION_POPULATE)

    if (!q) return NextResponse.json({ error: 'Only draft quotations can be edited' }, { status: 409 })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'QUOTATION',
      entityId: params.id,
      changes:  JSON.stringify({ quotationNumber: q.quotationNumber, total: q.total }),
      request,
    })

    return NextResponse.json({ data: quotationJSON(session, q) })
  } catch (err) {
    console.error('[PUT /api/quotations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/quotations/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.quotations.delete')
    if (denied) return denied
    await connectDB()
    const deleted = await Quotation.findByIdAndDelete(params.id)

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'QUOTATION',
      entityId: params.id,
      changes:  deleted ? JSON.stringify({ quotationNumber: deleted.quotationNumber }) : null,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
