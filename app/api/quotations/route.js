export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation, Lead, Client } from '@/models'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'

// GET /api/quotations
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.quotations.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit') ?? '20', 10)
    const status    = searchParams.get('status')
    const search    = searchParams.get('search')
    const leadId    = searchParams.get('leadId')
    const clientId  = searchParams.get('clientId')
    const skip      = (page - 1) * limit

    const filter = {}
    if (status)   filter.status   = status
    if (leadId)   filter.leadId   = leadId
    if (clientId) filter.clientId = clientId

    const populate = [
      { path: 'leadId',   select: 'name company' },
      { path: 'clientId', select: 'company contactPerson' },
      { path: 'createdBy', select: 'name avatar' },
    ]

    let quotations, total
    if (search) {
      // recipientName/Company/Email are encrypted; quotationNumber is plain — match all in JS
      ;({ docs: quotations, total } = await searchEncrypted(Quotation, {
        baseFilter: filter, search,
        fields: ['quotationNumber', 'recipientName', 'recipientCompany', 'recipientEmail'],
        page, limit, sort: { createdAt: -1 }, populate,
      }))
    } else {
      ;[quotations, total] = await Promise.all([
        Quotation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate(populate[0]).populate(populate[1]).populate(populate[2]),
        Quotation.countDocuments(filter),
      ])
    }

    return NextResponse.json({
      // hydrated docs (not .lean()) so populated Client.company decrypts correctly
      data: quotations.map(q => q.toJSON()),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/quotations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/quotations
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.quotations.create')
    if (denied) return denied

    await connectDB()

    const body = await request.json()
    const {
      sourceType, leadId, clientId,
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items = [], issueDate, validUntil, taxRate = 0, discount = 0,
      notes, terms, currency = 'BDT', itemPriceOnly = false,
    } = body

    if (!sourceType || !['LEAD', 'CLIENT'].includes(sourceType))
      return NextResponse.json({ error: 'sourceType must be LEAD or CLIENT' }, { status: 422 })
    if (sourceType === 'LEAD'   && !leadId)   return NextResponse.json({ error: 'leadId required' },   { status: 422 })
    if (sourceType === 'CLIENT' && !clientId) return NextResponse.json({ error: 'clientId required' }, { status: 422 })
    if (!items.length) return NextResponse.json({ error: 'At least one item required' }, { status: 422 })

    const processedItems = items.map(item => {
      const qty    = Number(item.quantity) || 1
      const rate   = Number(item.rate)     || 0
      return { description: item.description, venture: item.venture || null, service: item.service || null, quantity: qty, rate, amount: qty * rate }
    })

    const subtotal  = Math.round(processedItems.reduce((s, i) => s + i.amount, 0) * 100) / 100
    const taxAmount = Math.round(subtotal * ((Number(taxRate) || 0) / 100) * 100) / 100
    const total     = Math.round((subtotal + taxAmount - (Number(discount) || 0)) * 100) / 100

    const quotation = await new Quotation({
      sourceType,
      leadId:   sourceType === 'LEAD'   ? leadId   : null,
      clientId: sourceType === 'CLIENT' ? clientId : null,
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items: processedItems,
      issueDate:  issueDate  ? new Date(issueDate)  : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      subtotal, taxRate: Number(taxRate), taxAmount, discount: Number(discount), total,
      currency, notes: notes || null, terms: terms || null,
      itemPriceOnly: !!itemPriceOnly,
      createdBy: session.user.id,
    }).save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'QUOTATION',
      entityId: quotation._id.toString(),
      changes:  JSON.stringify({ quotationNumber: quotation.quotationNumber, total: quotation.total }),
      request,
    })

    return NextResponse.json({ data: quotation.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/quotations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
