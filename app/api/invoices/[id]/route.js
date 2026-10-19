export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, CombinedInvoice, ProjectPayment, Payment, Project, Client } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, INVOICE_PII } from '@/lib/pii'
import { toObjectId, projectInvoiceFilter } from '@/lib/combinedInvoice'
import { computeInvoiceTotals, INVOICE_VAT_TREATMENTS, uniformVatRate } from '@/lib/invoiceTotals'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDayStart } from '@/lib/dhakaTime'
import { getFinanceSettings } from '@/lib/finance/settings'
import { VAT_TREATMENTS } from '@/lib/tax/catalog'
import { BASE_CURRENCY, isValidCurrency } from '@/lib/currencies'

const isBlank = (v) => v === undefined || v === null || v === ''

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const cleanText = (v, max) => {
  if (isBlank(v)) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/** settings.vat, or null when finance settings cannot be read. */
async function loadVatSettings() {
  try {
    const settings = await getFinanceSettings()
    return settings?.vat ?? null
  } catch (err) {
    console.error('[api/invoices/:id] finance settings unavailable', err)
    return null
  }
}

/** Rate a treatment implies when neither the body nor the lines give one. */
function defaultRateFor(treatment, vat) {
  if (vat && treatment === vat.defaultSalesTreatment && Number.isFinite(Number(vat.defaultSalesRate)))
    return Number(vat.defaultSalesRate)
  return VAT_TREATMENTS.find(t => t.value === treatment)?.defaultRate ?? 0
}

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
    console.error('[GET /api/invoices/:id]', err)
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
    const {
      clientId, projectId, items, issueDate, dueDate, taxRate, discount, notes, terms, currency,
      vatTreatment, vatRate, serviceCode, deliveryDestination, totalBDT: bodyTotalBDT, fxRate,
    } = body ?? {}

    const existing = await Invoice.findById(params.id)
      .select('status vatTreatment items currency total totalBDT clientId projectId projectIds').lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Only drafts are editable: an issued invoice's totals are what the client
    // was billed and what payments were recorded against.
    if (existing.status !== 'DRAFT')
      return NextResponse.json({ error: `Only draft invoices can be edited (this one is ${existing.status})` }, { status: 409 })

    if (clientId !== undefined && !isValidObjectId(clientId))
      return NextResponse.json({ error: 'Invalid client' }, { status: 400 })
    if (projectId && !isValidObjectId(projectId))
      return NextResponse.json({ error: 'Invalid project' }, { status: 400 })

    // The invoice's client and project must belong together (same rule as POST):
    // checked on the pair the draft will END UP with, so changing only the
    // client of a project draft is caught too (legacy drafts: projectIds[0]).
    const finalClient  = clientId !== undefined ? clientId : existing.clientId
    const finalProject = projectId !== undefined
      ? (projectId || null)
      : (existing.projectId ?? existing.projectIds?.[0] ?? null)
    if (String(finalClient) !== String(existing.clientId) && !(await Client.exists({ _id: finalClient })))
      return NextResponse.json({ error: 'Client not found', field: 'clientId' }, { status: 422 })
    if (finalProject) {
      const project = await Project.findById(finalProject).select('clientId').lean()
      if (!project) return NextResponse.json({ error: 'Project not found', field: 'projectId' }, { status: 422 })
      if (String(project.clientId) !== String(finalClient))
        return NextResponse.json({ error: 'This project belongs to another client', field: 'projectId' }, { status: 422 })
    }
    // Legacy drafts stay linked through projectIds too (never edited here).
    const legacyIds = (existing.projectIds ?? []).filter(pid => String(pid) !== String(finalProject))
    if (legacyIds.length && await Project.exists({ _id: { $in: legacyIds }, clientId: { $ne: finalClient } }))
      return NextResponse.json({ error: 'This invoice is linked to a project of another client', field: 'clientId' }, { status: 422 })

    // VAT treatment: the body wins; otherwise keep the draft's own (legacy drafts
    // have none, which means "no VAT" — exactly how they were calculated before).
    const treatment = isBlank(vatTreatment)
      ? (existing.vatTreatment || 'NONE')
      : String(vatTreatment).toUpperCase()
    if (!INVOICE_VAT_TREATMENTS.includes(treatment))
      return NextResponse.json({ error: 'Invalid VAT treatment' }, { status: 422 })

    const vat = treatment === 'NONE' ? null : await loadVatSettings()
    if (vat && vat.registrationType !== 'REGISTERED')
      return NextResponse.json({
        error: 'The company is not VAT registered (Tax & VAT → Tax Settings), so invoices cannot carry VAT. Choose "No VAT".',
      }, { status: 422 })

    // Lines without their own VAT % take: body vatRate → the draft's single rate
    // (same treatment) → the treatment's default rate.
    const keptRate = treatment === existing.vatTreatment ? uniformVatRate(existing.items) : null
    const defaultVatRate = !isBlank(vatRate) ? vatRate : (keptRate ?? defaultRateFor(treatment, vat))

    const calc = computeInvoiceTotals({ items, taxRate, discount, vatTreatment: treatment, defaultVatRate })
    if (calc.error) return NextResponse.json({ error: calc.error }, { status: 422 })

    // Currency + BDT equivalent of the (recomputed) total.
    const finalCurrency = isBlank(currency)
      ? String(existing.currency || BASE_CURRENCY).toUpperCase()
      : String(currency).trim().toUpperCase()
    if (!isValidCurrency(finalCurrency)) return NextResponse.json({ error: 'Unsupported currency' }, { status: 422 })
    let totalBDT = null
    if (finalCurrency === BASE_CURRENCY) {
      totalBDT = round2(calc.total)
    } else if (!isBlank(bodyTotalBDT)) {
      const v = Number(bodyTotalBDT)
      if (!Number.isFinite(v) || v <= 0)
        return NextResponse.json({ error: 'BDT equivalent of the total must be a positive amount', field: 'totalBDT' }, { status: 422 })
      totalBDT = round2(v)
    } else if (!isBlank(fxRate)) {
      const r = Number(fxRate)
      if (!Number.isFinite(r) || r <= 0)
        return NextResponse.json({ error: 'Exchange rate must be a positive number (BDT per unit)', field: 'fxRate' }, { status: 422 })
      totalBDT = round2(calc.total * r)
    } else if (
      finalCurrency === String(existing.currency || BASE_CURRENCY).toUpperCase() &&
      Number(existing.totalBDT) > 0 && Number(existing.total) > 0
    ) {
      // Same foreign currency, no new rate given: keep the draft's exchange rate.
      totalBDT = round2(calc.total * (Number(existing.totalBDT) / Number(existing.total)))
    }

    const update = {
      items:     calc.items,
      subtotal:  calc.subtotal,
      taxRate:   calc.taxRate,
      taxAmount: calc.taxAmount,
      discount:  calc.discount,
      total:     calc.total,
      currency:  finalCurrency,
      totalBDT,
      vatTreatment: calc.vatTreatment,
      taxableValue: calc.taxableValue,
      vatAmount:    calc.vatAmount,
      sdAmount:     calc.sdAmount,
      dueDate:   dueDate ? new Date(dueDate) : null,
    }
    if (issueDate)               update.issueDate = new Date(issueDate)
    if (clientId !== undefined)  update.clientId  = clientId
    if (projectId !== undefined) update.projectId = projectId || null
    if (notes !== undefined)     update.notes     = notes || null
    if (terms !== undefined)     update.terms     = terms || null
    if (treatment === 'NONE')                update.serviceCode = null
    else if (serviceCode !== undefined)      update.serviceCode = cleanText(serviceCode, 20)
    if (deliveryDestination !== undefined)   update.deliveryDestination = cleanText(deliveryDestination, 300)

    // Conditional on DRAFT so a concurrent send/cancel can't be overwritten, and
    // on the client / project validated above so a concurrent edit can't leave
    // the draft with a project of another client.
    const invoice = await Invoice.findOneAndUpdate(
      { _id: params.id, status: 'DRAFT', clientId: existing.clientId, projectId: existing.projectId ?? null },
      { $set: update },
      { new: true, runValidators: true }
    )
    if (!invoice) {
      const still = await Invoice.exists({ _id: params.id, status: 'DRAFT' })
      return NextResponse.json({
        error: still
          ? 'This draft was changed in the meantime. Reload and try again.'
          : 'Only draft invoices can be edited',
      }, { status: 409 })
    }
    // Only what the form needs back — never the full Client (KYC, e-TIN, contact
    // details, staff notes); masked like GET.
    await invoice.populate([
      {
        path: 'clientId',
        select: 'company clientCode clientType contactPerson bin vatRegistrationType userId',
        populate: { path: 'userId', select: 'name avatar' },
      },
      { path: 'projectId', select: 'name projectCode venture category' },
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({
        total: invoice.total, status: invoice.status,
        vatTreatment: invoice.vatTreatment, vatAmount: invoice.vatAmount,
      }),
      request,
    })

    return NextResponse.json({ data: maskDoc(session, invoice.toJSON(), INVOICE_PII) })
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
    console.error('[DELETE /api/invoices/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
