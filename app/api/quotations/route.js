export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation, Lead, Client } from '@/models'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskList, stripMaskedValues, QUOTATION_PII } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'
import { findAccessibleLead } from '@/lib/leadAccess'
import { quotationJSON, computeQuotation } from '@/lib/quotation'

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

    // Searching on a masked field would confirm whether a given email exists
    const searchFields = ['quotationNumber', 'recipientName', 'recipientCompany']
    if (canDo(session, 'pii.contact.view')) searchFields.push('recipientEmail')

    let quotations, total
    if (search) {
      // recipientName/Company/Email are encrypted; quotationNumber is plain — match all in JS
      ;({ docs: quotations, total } = await searchEncrypted(Quotation, {
        baseFilter: filter, search,
        fields: searchFields,
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
      data: maskList(session, quotations.map(q => q.toJSON()), QUOTATION_PII),
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

    // Recipient fields may be pre-filled from masked lead/client data; never store a mask
    const body = stripMaskedValues(await request.json()) ?? {}
    const {
      sourceType, leadId, clientId,
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items = [], issueDate, validUntil, taxRate = 0, discount = 0,
      notes, terms, currency = 'BDT', itemPriceOnly = false,
    } = body

    if (!sourceType || !['LEAD', 'CLIENT'].includes(sourceType))
      return NextResponse.json({ error: 'sourceType must be LEAD or CLIENT' }, { status: 422 })
    if (sourceType === 'LEAD'   && !isValidObjectId(leadId))   return NextResponse.json({ error: 'leadId required' },   { status: 422 })
    if (sourceType === 'CLIENT' && !isValidObjectId(clientId)) return NextResponse.json({ error: 'clientId required' }, { status: 422 })

    const calc = computeQuotation({ items, taxRate, discount })
    if (calc.error) return NextResponse.json({ error: calc.error }, { status: 422 })

    // Snapshot the recipient server-side for any field left blank (or stripped
    // because it was masked), so the stored quotation holds the real values.
    let source
    if (sourceType === 'LEAD') {
      const lead = await findAccessibleLead(session, leadId, 'name company email phone location assignedToId')
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 422 })
      source = { name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, address: lead.location }
    } else {
      const client = await Client.findById(clientId).populate('userId', 'name email phone')
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 422 })
      source = {
        name:    client.contactPerson || client.userId?.name,
        company: client.company,
        email:   client.userId?.email,
        phone:   client.userId?.phone,
        address: [client.address, client.city, client.country].filter(Boolean).join(', '),
      }
    }
    const pick = (v, fallback) => (v == null || v === '' ? (fallback || null) : v)

    const quotation = await new Quotation({
      sourceType,
      leadId:   sourceType === 'LEAD'   ? leadId   : null,
      clientId: sourceType === 'CLIENT' ? clientId : null,
      recipientName:    pick(recipientName,    source.name),
      recipientCompany: pick(recipientCompany, source.company),
      recipientEmail:   pick(recipientEmail,   source.email),
      recipientPhone:   pick(recipientPhone,   source.phone),
      recipientAddress: pick(recipientAddress, source.address),
      items: calc.items,
      issueDate:  issueDate  ? new Date(issueDate)  : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      subtotal: calc.subtotal, taxRate: calc.taxRate, taxAmount: calc.taxAmount, discount: calc.discount, total: calc.total,
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

    return NextResponse.json({ data: quotationJSON(session, quotation) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/quotations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
