export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, ProjectPayment } from '@/models'
import { canDo } from '@/lib/rbac'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { isValidObjectId } from '@/lib/objectId'
import { pendingPaymentTotal } from '@/lib/paymentLedger'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

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

// POST /api/invoices/:id/payment-request
// Records a payment against an invoice — goes to Payment Confirmations for manual approval.
// On confirmation the invoice paidAmount + status are updated automatically.
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

    const body = await request.json()
    const { amount, paymentMethod, paymentDate, description, notes, receiptUrl } = body

    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0)
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 422 })

    // Money already sitting in pending requests is claimed — it must not be requested twice.
    const pending = await pendingPaymentTotal({ invoiceId: invoice._id })
    const balance = Math.max(0, Number(invoice.total ?? 0) - Number(invoice.paidAmount ?? 0) - pending)
    if (Number(amount) > balance + 0.01)
      return NextResponse.json({
        error: `Amount exceeds outstanding balance of ${invoice.currency ?? 'BDT'} ${balance.toFixed(2)}${pending > 0 ? ' (after pending payment requests)' : ''}`,
      }, { status: 422 })

    // Resolve project: prefer singular projectId (new), fall back to legacy projectIds array
    const projectId = invoice.projectId ?? invoice.projectIds?.[0]?._id ?? invoice.projectIds?.[0] ?? null

    const payment = await new ProjectPayment({
      projectId,
      invoiceId:     invoice._id,
      clientId:      invoice.clientId,
      submittedBy:   session.user.id,
      amount:        Number(amount),
      currency:      invoice.currency ?? 'BDT',
      paymentMethod: paymentMethod ?? 'BANK_TRANSFER',
      paymentDate:   paymentDate ? new Date(paymentDate) : new Date(),
      description:   description || `Payment for invoice ${invoice.invoiceNumber}`,
      notes:         notes || null,
      receiptUrl:    receiptUrl || null,
      status:        'PENDING_CONFIRMATION',
    }).save()

    return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
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

    const payments = await ProjectPayment.find({ invoiceId: params.id })
      .sort({ createdAt: -1 })
      // Staff email addresses are not exposed to client users
      .populate('submittedBy', staff ? 'name email' : 'name')
      .populate('confirmedBy', 'name')
      .populate('transactionId', 'txnId')
      .lean()

    return NextResponse.json({ data: payments.map(p => ({ ...p, id: p._id.toString() })) })
  } catch (err) {
    console.error('[GET /api/invoices/:id/payment-request]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
