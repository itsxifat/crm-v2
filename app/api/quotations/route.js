export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation, Client } from '@/models'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskList, stripMaskedValues, QUOTATION_PII } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'
import { isValidCurrency } from '@/lib/currencies'
import { findAccessibleLead } from '@/lib/leadAccess'
import { computeQuotation } from '@/lib/quotation'
import {
  QUOTATION_POPULATE, quotationJSON, QuotationBodySchema, validationBody,
  loadVatSettings, resolveQuotationVat, parseDateInput,
} from './_lib/server'

const STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']

const CreateSchema = QuotationBodySchema.extend({
  sourceType: z.enum(['LEAD', 'CLIENT'], { errorMap: () => ({ message: 'sourceType must be LEAD or CLIENT' }) }),
  leadId:     z.string().nullable().optional(),
  clientId:   z.string().nullable().optional(),
})

// GET /api/quotations?page&limit&status&search&leadId&clientId
// → { data: [quotation], meta: { page, limit, total, pages } }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.quotations.view')
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const page      = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit     = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const status    = searchParams.get('status')
    const search    = searchParams.get('search')
    const leadId    = searchParams.get('leadId')
    const clientId  = searchParams.get('clientId')
    const skip      = (page - 1) * limit

    if (status && !STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    if (leadId && !isValidObjectId(leadId))     return NextResponse.json({ error: 'Invalid lead' }, { status: 400 })
    if (clientId && !isValidObjectId(clientId)) return NextResponse.json({ error: 'Invalid client' }, { status: 400 })

    await connectDB()

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
      data: maskList(session, quotations.map(q => q.toJSON()), QUOTATION_PII),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/quotations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/quotations
// Body: { sourceType, leadId|clientId, recipient*, items:[{ description, venture, service_category,
//   service, quantity, rate, vatRate?, sdRate?, serviceCode? }], issueDate, validUntil,
//   taxRate (MFS charge %), discount, currency, notes, terms, itemPriceOnly,
//   vatTreatment?, vatRate?, serviceCode? }  — VAT fields default from finance settings.
// → 201 { data: quotation }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.quotations.create')
    if (denied) return denied

    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

    // Recipient fields may be pre-filled from masked lead/client data; never store a mask
    const parsed = CreateSchema.safeParse(stripMaskedValues(raw) ?? {})
    if (!parsed.success) return NextResponse.json(validationBody(parsed.error), { status: 422 })
    const {
      sourceType, leadId, clientId,
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items = [], issueDate, validUntil, taxRate = 0, discount = 0,
      notes, terms, currency = 'BDT', itemPriceOnly = false,
      vatTreatment, vatRate, serviceCode,
    } = parsed.data

    if (sourceType === 'LEAD'   && !isValidObjectId(leadId))   return NextResponse.json({ error: 'leadId required' },   { status: 422 })
    if (sourceType === 'CLIENT' && !isValidObjectId(clientId)) return NextResponse.json({ error: 'clientId required' }, { status: 422 })
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Unsupported currency' }, { status: 422 })

    const issue = parseDateInput(issueDate) ?? new Date()
    const valid = parseDateInput(validUntil) ?? null
    if (valid && valid.getTime() < issue.getTime())
      return NextResponse.json({ error: 'Valid until cannot be before the issue date' }, { status: 422 })

    await connectDB()

    // Snapshot the recipient server-side for any field left blank (or stripped
    // because it was masked), so the stored quotation holds the real values.
    let source, client = null
    if (sourceType === 'LEAD') {
      const lead = await findAccessibleLead(session, leadId, 'name company email phone location assignedToId')
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 422 })
      source = { name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, address: lead.location }
    } else {
      client = await Client.findById(clientId).populate('userId', 'name email phone')
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

    // VAT setup: the body wins; otherwise the company default from finance
    // settings (foreign clients → zero-rated export of services).
    const vat = await loadVatSettings()
    const vatSetup = resolveQuotationVat({ input: { vatTreatment, vatRate, serviceCode }, vat, client })
    if (vatSetup.error) return NextResponse.json({ error: vatSetup.error }, { status: 422 })

    const calc = computeQuotation({
      items, taxRate, discount,
      vatTreatment: vatSetup.treatment, defaultVatRate: vatSetup.defaultVatRate,
    })
    if (calc.error) return NextResponse.json({ error: calc.error }, { status: 422 })

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
      issueDate:  issue,
      validUntil: valid,
      subtotal: calc.subtotal, taxRate: calc.taxRate, taxAmount: calc.taxAmount, discount: calc.discount, total: calc.total,
      totalBDT: currency === 'BDT' ? calc.total : null,
      vatTreatment: calc.vatTreatment,
      taxableValue: calc.taxableValue,
      vatAmount:    calc.vatAmount,
      sdAmount:     calc.sdAmount,
      serviceCode:  vatSetup.serviceCode,
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
      changes:  JSON.stringify({
        quotationNumber: quotation.quotationNumber, total: quotation.total, currency: quotation.currency,
        vatTreatment: quotation.vatTreatment, vatAmount: quotation.vatAmount,
      }),
      request,
    })

    await quotation.populate(QUOTATION_POPULATE)
    return NextResponse.json({ data: quotationJSON(session, quotation) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/quotations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
