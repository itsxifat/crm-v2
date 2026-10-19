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
import { isValidCurrency } from '@/lib/currencies'
import { computeQuotation } from '@/lib/quotation'
import {
  QUOTATION_POPULATE, quotationJSON, QuotationBodySchema, validationBody,
  loadVatSettings, resolveQuotationVat, parseDateInput,
} from '../_lib/server'

// Fields compared for the audit-log diff of an edit.
const AUDITED = [
  'subtotal', 'discount', 'taxRate', 'taxAmount', 'total', 'currency',
  'vatTreatment', 'taxableValue', 'vatAmount', 'sdAmount', 'serviceCode', 'itemPriceOnly',
]

const sameValue = (a, b) => {
  const na = Number(a), nb = Number(b)
  if (a !== null && b !== null && a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.005
  return (a ?? null) === (b ?? null)
}

// GET /api/quotations/[id] → { data: quotation (+ buyerBin) }
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

// PUT /api/quotations/[id] — edit a DRAFT quotation.
// Body: same fields as POST (minus the source). Missing vatTreatment / vatRate /
// serviceCode keep the draft's own VAT setup.
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.quotations.update')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

    await connectDB()

    const existing = await Quotation.findById(params.id).lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'DRAFT')
      return NextResponse.json({ error: 'Only draft quotations can be edited' }, { status: 409 })

    // The edit form is pre-filled from the masked GET response — put the real
    // values back for any placeholder that was posted unchanged.
    const parsed = QuotationBodySchema.safeParse(restoreMaskedValues(raw, existing) ?? {})
    if (!parsed.success) return NextResponse.json(validationBody(parsed.error), { status: 422 })
    const {
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items, issueDate, validUntil, taxRate = 0, discount = 0,
      notes, terms, currency, itemPriceOnly,
      vatTreatment, vatRate, serviceCode,
    } = parsed.data

    if (currency && !isValidCurrency(currency)) return NextResponse.json({ error: 'Unsupported currency' }, { status: 422 })

    const issue = parseDateInput(issueDate)          // undefined = keep
    const valid = parseDateInput(validUntil) ?? null // not sent = cleared (full-form edit)
    const effectiveIssue = issue ?? existing.issueDate
    if (valid && effectiveIssue && valid.getTime() < new Date(effectiveIssue).getTime())
      return NextResponse.json({ error: 'Valid until cannot be before the issue date' }, { status: 422 })

    const vat = await loadVatSettings()
    const vatSetup = resolveQuotationVat({ input: { vatTreatment, vatRate, serviceCode }, vat, existing })
    if (vatSetup.error) return NextResponse.json({ error: vatSetup.error }, { status: 422 })

    const calc = computeQuotation({
      items, taxRate, discount,
      vatTreatment: vatSetup.treatment, defaultVatRate: vatSetup.defaultVatRate,
    })
    if (calc.error) return NextResponse.json({ error: calc.error }, { status: 422 })

    const nextCurrency = currency || existing.currency || 'BDT'

    // Conditional on DRAFT so a concurrent status change can't be overwritten
    const q = await Quotation.findOneAndUpdate({ _id: params.id, status: 'DRAFT' }, {
      recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
      items: calc.items,
      issueDate:  issue,
      validUntil: valid,
      subtotal: calc.subtotal, taxRate: calc.taxRate, taxAmount: calc.taxAmount, discount: calc.discount, total: calc.total,
      totalBDT: nextCurrency === 'BDT' ? calc.total : null,
      vatTreatment: calc.vatTreatment,
      taxableValue: calc.taxableValue,
      vatAmount:    calc.vatAmount,
      sdAmount:     calc.sdAmount,
      serviceCode:  vatSetup.serviceCode,
      ...(currency && { currency }),
      notes: notes ?? null, terms: terms ?? null,
      ...(itemPriceOnly !== undefined && { itemPriceOnly: !!itemPriceOnly }),
    }, { new: true }).populate(QUOTATION_POPULATE)

    if (!q) return NextResponse.json({ error: 'Only draft quotations can be edited' }, { status: 409 })

    const from = {}, to = {}
    for (const k of AUDITED) {
      if (!sameValue(existing[k], q[k])) { from[k] = existing[k] ?? null; to[k] = q[k] ?? null }
    }
    if ((existing.items?.length ?? 0) !== (q.items?.length ?? 0)) {
      from.itemCount = existing.items?.length ?? 0
      to.itemCount   = q.items?.length ?? 0
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'QUOTATION',
      entityId: params.id,
      changes:  JSON.stringify({ quotationNumber: q.quotationNumber, total: q.total, from, to }),
      request,
    })

    return NextResponse.json({ data: quotationJSON(session, q) })
  } catch (err) {
    console.error('[PUT /api/quotations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/quotations/[id] → { success: true }
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.quotations.delete')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const deleted = await Quotation.findByIdAndDelete(params.id)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'QUOTATION',
      entityId: params.id,
      changes:  JSON.stringify({
        quotationNumber: deleted.quotationNumber, status: deleted.status,
        total: deleted.total, currency: deleted.currency, vatTreatment: deleted.vatTreatment ?? 'NONE',
      }),
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/quotations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
