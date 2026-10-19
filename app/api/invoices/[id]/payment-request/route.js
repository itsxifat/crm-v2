export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, ProjectPayment, Project } from '@/models'
import { canDo } from '@/lib/rbac'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import {
  pendingPaymentTotal, pendingVdsTotal, readWithholding, withheldTotal, invoiceOutstanding,
  assertWithholdingAllowed, parseBusinessDate, httpErrorPayload, round2,
  WITHHOLDING_PAYMENT_METHOD,
} from '@/lib/paymentLedger'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

// Internal bookkeeping fields a client user never sees on their payment list.
const STAFF_ONLY_FIELDS = ['accountId', 'channel', 'taxEntryIds', 'reversedBy', 'reversalReason', 'reversalTransactionId']

/**
 * Can this session act on this invoice's payments?
 * - staff: need the given permission
 * - CLIENT: the invoice must belong to one of their companies and be issued (not DRAFT)
 * - everyone else: no
 */
async function canAccessInvoice(session, invoice, staffPerm) {
  const role = session?.user?.role
  if (STAFF_ROLES.includes(role)) return canDo(session, staffPerm)
  if (role !== 'CLIENT') return false
  if (!invoice?.clientId || invoice.status === 'DRAFT') return false
  const companyIds = await getMyCompanyIds(session.user.id)
  const clientId   = (invoice.clientId._id ?? invoice.clientId).toString()
  return companyIds.some(c => c.toString() === clientId)
}

const str = (v, max) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

// POST /api/invoices/:id/payment-request
// Records a payment against an invoice — goes to Payment Confirmations for manual approval.
// On confirmation the invoice paidAmount + status are updated automatically.
//
// Body: { amount, paymentMethod?, paymentDate?, description?, notes?, receiptUrl? }
// Staff may also send the tax the client withheld at source (BDT invoices only):
//   { vdsAmount?, tdsAmount?, tdsSection?, vdsCertificateNo?, vdsCertificateDate?,
//     tdsCertificateNo?, tdsCertificateDate? } — then amount may be 0 (withholding only).
// amount + vdsAmount + tdsAmount must fit the outstanding balance minus pending requests.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    await connectDB()

    const invoice = await Invoice.findById(params.id).populate('projectIds')
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const staff = STAFF_ROLES.includes(session.user?.role)
    if (!(await canAccessInvoice(session, invoice, 'finance.payments.request'))) {
      // Don't reveal other tenants' invoices to external users
      return staff
        ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        : NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Payments are only taken against issued invoices (SENT / PARTIALLY_PAID / OVERDUE)
    if (['DRAFT', 'PAID', 'CANCELLED'].includes(invoice.status))
      return NextResponse.json({ error: `Cannot add payment to a ${invoice.status.toLowerCase()} invoice` }, { status: 409 })

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const { amount, paymentMethod, paymentDate, description, notes, receiptUrl } = body

    // Tax withheld at source is recorded by staff only (clients cannot claim it).
    let w
    try {
      w = readWithholding(staff ? body : {})
    } catch (err) {
      return NextResponse.json({ error: err.message, ...(err.field ? { field: err.field } : {}) }, { status: err.status ?? 422 })
    }
    if (!staff) {
      const claimsWithholding = ['vdsAmount', 'tdsAmount'].some(k => Number(body[k]) > 0)
      if (claimsWithholding)
        return NextResponse.json({ error: 'Tax withheld at source is recorded by our finance team — send the cash amount only' }, { status: 422 })
    }
    const withheld = withheldTotal(w)

    const cash = amount === null || amount === undefined || amount === '' ? 0 : Number(amount)
    if (!Number.isFinite(cash) || cash < 0 || (!(cash > 0) && !(withheld > 0)))
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 422 })

    const parsedDate = paymentDate ? parseBusinessDate(paymentDate) : new Date()
    if (!parsedDate) return NextResponse.json({ error: 'Invalid payment date' }, { status: 422 })

    if (withheld > 0) {
      try {
        // VDS already sitting in pending requests uses up the VDS cap too.
        const pendingVds = w.vdsAmount > 0 ? await pendingVdsTotal(invoice._id) : 0
        await assertWithholdingAllowed(invoice.toObject(), w, { date: parsedDate, pendingVds })
      } catch (err) {
        const mapped = httpErrorPayload(err)
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
        throw err
      }
    }

    // Money already sitting in pending requests is claimed — it must not be requested twice.
    const settled = round2(cash + withheld)
    const pending = await pendingPaymentTotal({ invoiceId: invoice._id })
    const balance = Math.max(0, invoiceOutstanding(invoice) - pending)
    if (settled > balance + 0.01)
      return NextResponse.json({
        error: `Amount${withheld > 0 ? ' plus tax withheld' : ''} exceeds outstanding balance of ${invoice.currency ?? 'BDT'} ${balance.toFixed(2)}${pending > 0 ? ' (after pending payment requests)' : ''}`,
      }, { status: 422 })

    // Resolve project: prefer singular projectId (new), fall back to legacy projectIds array
    let projectId = invoice.projectId ?? invoice.projectIds?.[0]?._id ?? invoice.projectIds?.[0] ?? null
    // Never credit another client's project: an (old) invoice raised against a
    // project of a different client keeps its payment off that project.
    if (projectId) {
      const owner = await Project.findById(projectId).select('clientId').lean()
      if (owner && String(owner.clientId) !== String(invoice.clientId)) projectId = null
    }

    const payment = await new ProjectPayment({
      projectId,
      invoiceId:          invoice._id,
      clientId:           invoice.clientId,
      submittedBy:        session.user.id,
      amount:             round2(cash),
      currency:           invoice.currency ?? 'BDT',
      paymentMethod:      cash > 0 ? (str(paymentMethod, 40) ?? 'BANK_TRANSFER') : WITHHOLDING_PAYMENT_METHOD,
      paymentDate:        parsedDate,
      description:        str(description, 500) || `Payment for invoice ${invoice.invoiceNumber}`,
      notes:              str(notes, 2000),
      receiptUrl:         str(receiptUrl, 1000),
      vdsAmount:          w.vdsAmount,
      tdsAmount:          w.tdsAmount,
      tdsSection:         w.tdsSection,
      vdsCertificateNo:   w.vdsCertificateNo,
      vdsCertificateDate: w.vdsCertificateDate,
      tdsCertificateNo:   w.tdsCertificateNo,
      tdsCertificateDate: w.tdsCertificateDate,
      settledAmount:      settled,
      status:             'PENDING_CONFIRMATION',
    }).save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'PROJECT_PAYMENT',
      entityId: payment._id.toString(),
      changes:  JSON.stringify({
        invoiceId: invoice._id.toString(), amount: round2(cash), currency: invoice.currency ?? 'BDT',
        vdsAmount: w.vdsAmount, tdsAmount: w.tdsAmount, status: 'PENDING_CONFIRMATION',
      }),
      request,
    })

    const data = payment.toJSON()
    if (!staff) for (const k of STAFF_ONLY_FIELDS) delete data[k]
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/invoices/:id/payment-request]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/invoices/:id/payment-request — list all payment requests for this invoice.
// Read-only: payments recorded against the project before it had an invoice
// (invoiceId null) stay project-level; they are NOT retroactively attached here,
// since that would list them on the invoice without crediting its paidAmount.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const invoice = await Invoice.findById(params.id).select('clientId status').lean()
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const staff = STAFF_ROLES.includes(session.user?.role)
    if (!(await canAccessInvoice(session, invoice, 'sales.invoices.view'))) {
      return staff
        ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        : NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let query = ProjectPayment.find({ invoiceId: params.id })
      .sort({ createdAt: -1 })
      // Staff email addresses are not exposed to client users
      .populate('submittedBy', staff ? 'name email' : 'name')
      .populate('confirmedBy', 'name')
      .populate('transactionId', 'txnId')
    if (staff) {
      query = query
        .populate('accountId', 'name type currency last4 bankName mfsProvider')
        .populate('reversedBy', 'name')
        .populate('reversalTransactionId', 'txnId')
    }
    const payments = await query.lean()

    return NextResponse.json({
      data: payments.map(p => {
        const row = { ...p, id: p._id.toString() }
        if (!staff) for (const k of STAFF_ONLY_FIELDS) delete row[k]
        return row
      }),
    })
  } catch (err) {
    console.error('[GET /api/invoices/:id/payment-request]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
