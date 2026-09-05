export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CombinedInvoice } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { buildCombined } from '@/lib/combinedInvoice'
import { maskDoc, INVOICE_PII } from '@/lib/pii'

async function loadPopulated(id) {
  return CombinedInvoice.findById(id)
    .populate('projectId', 'name projectCode venture category budget discount')
    .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email avatar phone' } })
    .populate('createdBy', 'name')
}

// GET /api/combined-invoices/:id
// Every figure returned here is recomputed from the child invoices, so the
// response always reflects their current totals, payments and statuses.
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.view')
    if (denied) return denied
    await connectDB()

    const doc = await loadPopulated(params.id)
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data = await buildCombined(doc)
    return NextResponse.json({ data: maskDoc(session, data, INVOICE_PII) })
  } catch (err) {
    console.error('[GET /api/combined-invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/combined-invoices/:id — notes / terms only. Money is never editable
// here; it belongs to the child invoices.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.update')
    if (denied) return denied
    await connectDB()

    const { notes, terms } = await request.json()
    const doc = await CombinedInvoice.findById(params.id)
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (notes !== undefined) doc.notes = notes || null
    if (terms !== undefined) doc.terms = terms || null
    await doc.save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({ combinedNumber: doc.combinedNumber, notes: !!notes, terms: !!terms }),
      request,
    })

    const populated = await loadPopulated(params.id)
    return NextResponse.json({ data: await buildCombined(populated) })
  } catch (err) {
    console.error('[PATCH /api/combined-invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/combined-invoices/:id — removes only the consolidated wrapper.
// Child invoices are untouched.
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.delete')
    if (denied) return denied
    await connectDB()

    const doc = await CombinedInvoice.findByIdAndDelete(params.id)
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({ combinedNumber: doc.combinedNumber }),
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/combined-invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
