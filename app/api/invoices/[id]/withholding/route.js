export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, ProjectPayment, TaxEntry } from '@/models'
import { requirePerm, canDoAny, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { formatMoney } from '@/lib/currencies'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { maskList, TAX_ENTRY_PII } from '@/lib/pii'
import {
  PAYABLE_INVOICE_STATUSES, WITHHOLDING_PAYMENT_METHOD,
  readWithholding, withheldTotal, invoiceOutstanding, invoiceLabel, pendingPaymentTotal, pendingVdsTotal,
  assertWithholdingAllowed, preflightPosting, parseBusinessDate,
  settleInvoicePayment, settlementSummary, settlementDescription, httpErrorPayload, round2,
} from '@/lib/paymentLedger'
import { z } from 'zod'

const optStr = (max) => z.string().max(max).optional().nullable()
const optMoney = z.union([z.number(), z.string()]).optional().nullable()

const bodySchema = z.object({
  vdsAmount:          optMoney,
  tdsAmount:          optMoney,
  tdsSection:         optStr(40),
  vdsCertificateNo:   optStr(100),
  vdsCertificateDate: optStr(40),
  tdsCertificateNo:   optStr(100),
  tdsCertificateDate: optStr(40),
  date:               optStr(40),
  note:               optStr(500),
})

const n = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

const errorJson = (err) => {
  const mapped = httpErrorPayload(err)
  return mapped ? NextResponse.json(mapped.body, { status: mapped.status }) : null
}

// GET /api/invoices/:id/withholding
// Settlement breakdown of an invoice (cash / VDS / TDS / credit notes) with the
// VDS_RECEIVABLE / TDS_RECEIVABLE tax entries and their certificate status.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!canDoAny(session, ['sales.invoices.view', 'finance.payments.confirm', 'finance.transactions.view', 'tax.view']))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const invoice = await Invoice.findById(params.id)
      .select('invoiceNumber status currency total paidAmount withheldVds withheldTds creditedAmount debitedAmount vatTreatment vatAmount sdAmount taxableValue')
      .lean()
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [entries, payments] = await Promise.all([
      TaxEntry.find({ invoiceId: invoice._id, entryType: { $in: ['VDS_RECEIVABLE', 'TDS_RECEIVABLE'] }, isOpening: { $ne: true } })
        .sort({ date: -1, createdAt: -1 })
        .select('entryNo entryType status voidReason date period baseAmount rate amount section treatment certificate projectPaymentId transactionId partyName partyTin createdAt')
        .lean(),
      ProjectPayment.find({ invoiceId: invoice._id, status: 'CONFIRMED', $or: [{ vdsAmount: { $gt: 0 } }, { tdsAmount: { $gt: 0 } }] })
        .sort({ paymentDate: -1 })
        .select('amount currency paymentMethod paymentDate vdsAmount tdsAmount tdsSection vdsCertificateNo vdsCertificateDate tdsCertificateNo tdsCertificateDate settledAmount transactionId taxEntryIds confirmedAt')
        .lean(),
    ])

    const paid = round2(n(invoice.paidAmount))
    const vds = round2(n(invoice.withheldVds))
    const tds = round2(n(invoice.withheldTds))
    const credited = round2(n(invoice.creditedAmount))

    return NextResponse.json({
      data: {
        invoiceId:      invoice._id.toString(),
        invoiceNumber:  invoice.invoiceNumber ?? null,
        status:         invoice.status,
        currency:       invoice.currency || 'BDT',
        total:          round2(n(invoice.total)),
        paidAmount:     paid,
        outstanding:    Math.max(0, invoiceOutstanding(invoice)),
        breakdown: {
          cash:     Math.max(0, round2(paid - vds - tds - credited)),
          vds,
          tds,
          credited,
          debited:  round2(n(invoice.debitedAmount)),
        },
        canRecord:      PAYABLE_INVOICE_STATUSES.includes(invoice.status) && (invoice.currency || 'BDT') === 'BDT',
        entries:        maskList(session, entries.map(e => ({ ...e, id: e._id.toString() })), TAX_ENTRY_PII),
        payments:       payments.map(p => ({ ...p, id: p._id.toString() })),
      },
    })
  } catch (err) {
    console.error('[GET /api/invoices/:id/withholding]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/invoices/:id/withholding
// Record VAT (VDS) and/or income tax (TDS) the client withheld at source from
// this invoice, without cash: a CONFIRMED ProjectPayment (amount 0, method
// WITHHOLDING), a NON_CASH INCOME ledger row (P&L = withheld − VAT share), the
// invoice credited, VDS_RECEIVABLE / TDS_RECEIVABLE tax entries.
// Body: { vdsAmount, tdsAmount, tdsSection?, vdsCertificateNo?, vdsCertificateDate?,
//         tdsCertificateNo?, tdsCertificateDate?, date? ('YYYY-MM-DD', default today), note? }
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    const body = parsed.data

    const invoice = await Invoice.findById(params.id).lean()
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status))
      return NextResponse.json({ error: `${invoiceLabel(invoice)} is ${String(invoice.status).toLowerCase()} — tax withheld can only be recorded on an issued invoice with a balance` }, { status: 409 })

    let w
    try { w = readWithholding(body) } catch (err) { return errorJson(err) ?? NextResponse.json({ error: err.message }, { status: 422 }) }
    const withheld = withheldTotal(w)
    if (!(withheld > 0)) return NextResponse.json({ error: 'Enter the VDS and/or TDS amount the client withheld', field: 'vdsAmount' }, { status: 422 })

    const date = body.date ? parseBusinessDate(body.date) : new Date()
    if (!date) return NextResponse.json({ error: 'Invalid date', field: 'date' }, { status: 422 })
    // Tax is withheld when the client pays — never on a future day (Asia/Dhaka).
    if (dhakaDayKey(date) > dhakaDayKey(new Date()))
      return NextResponse.json({ error: 'The date withheld cannot be in the future', field: 'date' }, { status: 422 })

    try {
      // VDS in pending payment requests already uses up part of the VDS cap.
      const pendingVds = w.vdsAmount > 0 ? await pendingVdsTotal(invoice._id) : 0
      await assertWithholdingAllowed(invoice, w, { date, pendingVds })
      await preflightPosting({ date, cash: 0 })
    } catch (err) {
      const res = errorJson(err)
      if (res) return res
      throw err
    }

    const pending = await pendingPaymentTotal({ invoiceId: invoice._id })
    const outstanding = Math.max(0, invoiceOutstanding(invoice) - pending)
    if (withheld > outstanding + 0.01) {
      return NextResponse.json({
        error: `Tax withheld (${formatMoney(withheld, 'BDT')}) exceeds the outstanding balance of ${formatMoney(outstanding, 'BDT')}${pending > 0 ? ' (after pending payment requests)' : ''}`,
      }, { status: 422 })
    }

    const note = body.note?.trim() || null
    const projectId = invoice.projectId ?? invoice.projectIds?.[0] ?? null
    const payment = await new ProjectPayment({
      projectId,
      invoiceId:          invoice._id,
      clientId:           invoice.clientId,
      submittedBy:        session.user.id,
      amount:             0,
      currency:           'BDT',
      amountBDT:          0,
      paymentMethod:      WITHHOLDING_PAYMENT_METHOD,
      paymentDate:        date,
      description:        note || `Tax withheld at source — ${invoice.invoiceNumber ?? 'invoice'}`,
      notes:              note,
      vdsAmount:          w.vdsAmount,
      tdsAmount:          w.tdsAmount,
      tdsSection:         w.tdsSection,
      vdsCertificateNo:   w.vdsCertificateNo,
      vdsCertificateDate: w.vdsCertificateDate,
      tdsCertificateNo:   w.tdsCertificateNo,
      tdsCertificateDate: w.tdsCertificateDate,
      settledAmount:      withheld,
      status:             'CONFIRMED',
      confirmedBy:        session.user.id,
      confirmedAt:        new Date(),
      transactionId:      null,
    }).save()

    let result
    try {
      result = await settleInvoicePayment({
        invoice,
        projectId,
        projectPayment: payment,
        cash:           0,
        currency:       'BDT',
        withholding:    w,
        date,
        paidAt:         date,
        userId:         session.user.id,
        entry: {
          category:       'Project Revenue',
          description:    settlementDescription({ cash: 0, vds: w.vdsAmount, tds: w.tdsAmount, note, label: invoice.invoiceNumber ?? null }),
          reference:      invoice.invoiceNumber ?? null,
          clientId:       invoice.clientId ? String(invoice.clientId) : null,
          accountManager: session.user.id,
          createdBy:      session.user.id,
        },
      })
    } catch (err) {
      await ProjectPayment.deleteOne({ _id: payment._id, transactionId: null })
        .catch(e => console.error('[POST /api/invoices/:id/withholding] could not remove the unbooked payment', e))
      const res = errorJson(err)
      if (res) return res
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'PAYMENT',
      entity:   'PROJECT_PAYMENT',
      entityId: payment._id.toString(),
      changes:  JSON.stringify({
        kind: 'WITHHOLDING', invoiceId: invoice._id.toString(), invoiceNumber: invoice.invoiceNumber ?? null,
        vdsAmount: w.vdsAmount, tdsAmount: w.tdsAmount, tdsSection: w.tdsSection,
        transactionId: String(result.transaction._id), taxEntryIds: result.taxEntries.map(e => String(e._id)),
        invoiceStatus: { from: invoice.status, to: result.invoice?.status ?? invoice.status },
      }),
      request,
    })

    // Certificates are what make the withheld tax claimable — remind when missing.
    const missing = []
    if (w.vdsAmount > 0 && !w.vdsCertificateNo) missing.push('the VDS certificate (Mushak-6.6) — the VAT credit is claimed with it')
    if (w.tdsAmount > 0 && !w.tdsCertificateNo) missing.push('the TDS certificate — the tax credit in the income tax return needs it')
    const warning = missing.length ? `Recorded. Collect ${missing.join(' and ')} from the client.` : undefined

    const fresh = await ProjectPayment.findById(payment._id).populate('confirmedBy', 'name')
    return NextResponse.json({ data: fresh.toJSON(), settlement: settlementSummary(result), ...(warning && { warning }) }, { status: 201 })
  } catch (err) {
    const res = errorJson(err)
    if (res) return res
    console.error('[POST /api/invoices/:id/withholding]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
