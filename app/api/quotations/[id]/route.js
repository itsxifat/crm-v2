export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation } from '@/models'

// GET /api/quotations/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const q = await Quotation.findById(params.id)
      .populate('leadId',    'name company email phone location')
      .populate('clientId',  'company contactPerson address city country', null, { populate: { path: 'userId', select: 'name email phone' } })
      .populate('createdBy', 'name avatar')
    if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: q.toJSON() })
  } catch (err) {
    console.error('[GET /api/quotations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/quotations/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body = await request.json()
    const {
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items = [], issueDate, validUntil, taxRate = 0, discount = 0,
      notes, terms, currency,
    } = body

    const processedItems = items.map(item => {
      const qty  = Number(item.quantity) || 1
      const rate = Number(item.rate)     || 0
      return { description: item.description, venture: item.venture || null, service: item.service || null, quantity: qty, rate, amount: qty * rate }
    })

    const subtotal  = processedItems.reduce((s, i) => s + i.amount, 0)
    const taxAmount = subtotal * (Number(taxRate) / 100)
    const total     = subtotal + taxAmount - Number(discount)

    const q = await Quotation.findByIdAndUpdate(params.id, {
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items: processedItems,
      issueDate:  issueDate  ? new Date(issueDate)  : undefined,
      validUntil: validUntil ? new Date(validUntil) : null,
      subtotal, taxRate: Number(taxRate), taxAmount, discount: Number(discount), total,
      ...(currency && { currency }),
      notes: notes ?? null, terms: terms ?? null,
    }, { new: true })

    if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: q.toJSON() })
  } catch (err) {
    console.error('[PUT /api/quotations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/quotations/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()
    await Quotation.findByIdAndDelete(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
