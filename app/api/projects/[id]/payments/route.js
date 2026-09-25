export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectPayment, Transaction, Invoice } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { canDo, canDoAny, requireStaff } from '@/lib/rbac'
import { canAccessProject, canViewProjectFinancials } from '@/lib/projectAccess'
import { BASE_CURRENCY, isValidCurrency } from '@/lib/currencies'
import { projectInvoiceFilter } from '@/lib/combinedInvoice'
import {
  PAYABLE_INVOICE_STATUSES, applyInvoicePayment, creditProjectPaid, pendingPaymentTotal,
} from '@/lib/paymentLedger'

// GET /api/projects/:id/payments
// Payment history is project financial data: staff with access to the project
// AND project financial visibility (same rule as GET /api/projects/:id).
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canViewProjectFinancials(session))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    if (!(await canAccessProject(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const payments = await ProjectPayment.find({ projectId: params.id })
      .sort({ paymentDate: -1 })
      .populate('submittedBy', 'name avatar')
      .populate('confirmedBy', 'name')

    return NextResponse.json({ data: payments.map(p => p.toJSON()) })
  } catch (err) {
    console.error('[GET /api/projects/:id/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/:id/payments  — record a client payment
// Staff holding finance.payments.confirm are auto-confirmed and immediately update
// the ledger. Staff with only finance.payments.request create a
// PENDING_CONFIRMATION record for review.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['finance.payments.request', 'finance.payments.confirm']))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    await connectDB()

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!(await canAccessProject(session, project)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const { amount, currency: bodyCurrency, amountBDT, paymentMethod, paymentDate, description, notes, receiptUrl, invoiceId: bodyInvoiceId } = body

    const parsedAmt = Number(amount)
    if (!amount || !Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 422 })
    }
    const parsedDate = paymentDate ? new Date(paymentDate) : new Date()
    if (Number.isNaN(parsedDate.getTime()))
      return NextResponse.json({ error: 'Invalid payment date' }, { status: 422 })

    const isAdmin = canDo(session, 'finance.payments.confirm')

    // Resolve which invoice this payment settles. A project can carry many
    // invoices now, so when the caller doesn't name one we apply the payment to
    // the OLDEST invoice that still has an outstanding balance — the usual
    // "clear the oldest debt first" convention. A settled invoice is never
    // auto-linked; with nothing outstanding the payment stays project-level and
    // is checked against the project balance below.
    let invoiceId = null
    let linkedInvoice = null
    if (!bodyInvoiceId) {
      const candidates = await Invoice.find({
        ...projectInvoiceFilter(params.id),
        clientId: project.clientId,
        status: { $in: PAYABLE_INVOICE_STATUSES },
      }).select('_id total paidAmount currency invoiceNumber issueDate').sort({ issueDate: 1, createdAt: 1 }).lean()

      linkedInvoice = candidates.find(i => (Number(i.total ?? 0) - Number(i.paidAmount ?? 0)) > 0.01) ?? null
    } else {
      // The named invoice must be a payable invoice of THIS project.
      if (!isValidObjectId(bodyInvoiceId)) return NextResponse.json({ error: 'Invalid invoiceId' }, { status: 400 })
      linkedInvoice = await Invoice.findOne({
        _id: bodyInvoiceId,
        ...projectInvoiceFilter(params.id),
        status: { $nin: ['CANCELLED', 'DRAFT'] },
      }).select('_id total paidAmount currency invoiceNumber status').lean()
      if (!linkedInvoice) return NextResponse.json({ error: 'Invoice not found for this project' }, { status: 422 })
      if (!PAYABLE_INVOICE_STATUSES.includes(linkedInvoice.status))
        return NextResponse.json({ error: `Invoice ${linkedInvoice.invoiceNumber ?? ''} is already ${String(linkedInvoice.status).toLowerCase()}` }, { status: 422 })
    }
    if (linkedInvoice) invoiceId = linkedInvoice._id

    // Currency: an invoice payment is always in the invoice's currency.
    let currency = bodyCurrency || project.currency || BASE_CURRENCY
    if (linkedInvoice) {
      const invCurrency = linkedInvoice.currency || BASE_CURRENCY
      if (bodyCurrency && bodyCurrency !== invCurrency)
        return NextResponse.json({ error: `Invoice ${linkedInvoice.invoiceNumber ?? ''} is in ${invCurrency}; record the payment in ${invCurrency}` }, { status: 422 })
      currency = invCurrency
    }
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Unsupported currency' }, { status: 422 })

    // BDT-equivalent. For foreign currency the BDT actually received must be given
    // (required to confirm; optional on a pending request — the confirmer sets it).
    let bdt = null
    if (currency === BASE_CURRENCY) {
      bdt = parsedAmt
    } else if (amountBDT != null && amountBDT !== '') {
      bdt = Number(amountBDT)
      if (!Number.isFinite(bdt) || bdt <= 0)
        return NextResponse.json({ error: 'Invalid BDT amount' }, { status: 422 })
    }
    if (isAdmin && bdt == null)
      return NextResponse.json({ error: `Enter the BDT amount received for this ${currency} payment` }, { status: 422 })

    // Outstanding balance check — invoice balance, else project balance. Money in
    // pending requests is already claimed, so it is subtracted too.
    if (linkedInvoice) {
      const pending     = await pendingPaymentTotal({ invoiceId })
      const outstanding = Math.max(0, Number(linkedInvoice.total ?? 0) - Number(linkedInvoice.paidAmount ?? 0) - pending)
      if (parsedAmt > outstanding + 0.01) {
        return NextResponse.json(
          { error: `Amount exceeds outstanding invoice balance of ${currency} ${outstanding.toFixed(2)}${pending > 0 ? ' (after pending payment requests)' : ''}` },
          { status: 422 }
        )
      }
    } else {
      const budget  = Number(project.budget ?? 0)
      const paid    = Number(project.paidAmount ?? 0)
      const pending = await pendingPaymentTotal({ projectId: project._id })
      const outstanding = Math.max(0, budget - paid - pending)
      const checkAmt = bdt ?? parsedAmt
      if (budget > 0 && checkAmt > outstanding + 0.01) {
        return NextResponse.json(
          { error: `Amount exceeds outstanding project balance of BDT ${outstanding.toFixed(2)}${pending > 0 ? ' (after pending payment requests)' : ''}` },
          { status: 422 }
        )
      }
    }

    const paymentData = {
      projectId:     project._id,
      invoiceId:     invoiceId || null,
      clientId:      project.clientId,
      submittedBy:   session.user.id,
      amount:        parsedAmt,
      currency,
      amountBDT:     bdt,
      paymentMethod: paymentMethod ?? 'BANK_TRANSFER',
      paymentDate:   parsedDate,
      description:   description || null,
      notes:         notes || null,
      receiptUrl:    receiptUrl || null,
    }

    if (isAdmin) {
      // Confirmers confirm immediately — no separate confirmation step required
      const tx = await new Transaction({
        type:           'INCOME',
        category:       'Project Revenue',
        amount:         parsedAmt,
        currency,
        amountBDT:      bdt,
        description:    `Payment received${description ? ': ' + description : ''} — ${project.name ?? project.projectCode}`,
        date:           parsedDate,
        reference:      project.projectCode ?? null,
        projectId:      project._id,
        invoiceId:      invoiceId || null,
        clientId:       project.clientId?.toString() ?? null,
        paymentMethod:  paymentMethod ?? 'BANK_TRANSFER',
        receiptUrl:     receiptUrl || null,
        accountManager: session.user.id,
        createdBy:      session.user.id,
      }).save()

      // Sync linked invoice atomically — refuses if it was paid in the meantime
      if (invoiceId) {
        const updated = await applyInvoicePayment(invoiceId, parsedAmt, parsedDate)
        if (!updated) {
          await Transaction.deleteOne({ _id: tx._id })
          return NextResponse.json({ error: 'The invoice was paid or changed in the meantime — this amount no longer fits its balance' }, { status: 409 })
        }
      }

      const payment = await new ProjectPayment({
        ...paymentData,
        status:        'CONFIRMED',
        confirmedBy:   session.user.id,
        confirmedAt:   new Date(),
        transactionId: tx._id,
      }).save()

      // Project value is tracked in BDT
      await creditProjectPaid(project._id, bdt)

      await payment.populate('submittedBy', 'name avatar')
      return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
    }

    // Requester path: pending confirmation
    const payment = await new ProjectPayment({
      ...paymentData,
      status: 'PENDING_CONFIRMATION',
    }).save()

    await payment.populate('submittedBy', 'name avatar')
    return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/:id/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
