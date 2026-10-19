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
import { logActivity } from '@/lib/logActivity'
import { normalizeChannel } from '@/lib/finance/constants'
import { dhakaDayKey } from '@/lib/dhakaTime'
import {
  PAYABLE_INVOICE_STATUSES, WITHHOLDING_PAYMENT_METHOD, pendingPaymentTotal, pendingVdsTotal,
  readWithholding, withheldTotal, invoiceOutstanding, invoiceLabel,
  assertWithholdingAllowed, loadPostingAccount, preflightPosting, parseBusinessDate,
  settleInvoicePayment, settlementSummary, settlementDescription, httpErrorPayload, round2,
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
      .populate('reversedBy', 'name')
      .populate('accountId', 'name type currency last4 bankName mfsProvider')

    return NextResponse.json({ data: payments.map(p => p.toJSON()) })
  } catch (err) {
    console.error('[GET /api/projects/:id/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const str = (v, max = 500) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

const errorJson = (err) => {
  const mapped = httpErrorPayload(err)
  return mapped ? NextResponse.json(mapped.body, { status: mapped.status }) : null
}

// POST /api/projects/:id/payments  — record a client payment
// Staff holding finance.payments.confirm are auto-confirmed and immediately update
// the ledger. Staff with only finance.payments.request create a
// PENDING_CONFIRMATION record for review.
//
// Body: { amount, currency?, amountBDT?, paymentMethod?, paymentDate?, description?, notes?,
//   receiptUrl?, invoiceId?, accountId?, channel?, cheque?:{no,date,bank}, txnId?,
//   vdsAmount?, tdsAmount?, tdsSection?, vdsCertificateNo?, vdsCertificateDate?,
//   tdsCertificateNo?, tdsCertificateDate? }
// amount may be 0 when VDS/TDS is withheld (withholding-only settlement of an invoice).
export async function POST(request, { params }) {
  let txnIdForError = null
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

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const {
      amount, currency: bodyCurrency, amountBDT, paymentMethod, paymentDate, description, notes, receiptUrl,
      invoiceId: bodyInvoiceId, accountId: bodyAccountId, channel: bodyChannel, cheque, txnId: bodyTxnId,
    } = body

    // Tax withheld by the client (VDS / TDS) — validated against the invoice below.
    let w
    try { w = readWithholding(body) } catch (err) { return errorJson(err) ?? NextResponse.json({ error: err.message }, { status: 422 }) }
    const withheld = withheldTotal(w)

    const parsedAmt = amount === null || amount === undefined || amount === '' ? 0 : Number(amount)
    if (!Number.isFinite(parsedAmt) || parsedAmt < 0 || (!(parsedAmt > 0) && !(withheld > 0)))
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 422 })
    const cashAmt = round2(parsedAmt)

    const parsedDate = paymentDate ? parseBusinessDate(paymentDate) : new Date()
    if (!parsedDate) return NextResponse.json({ error: 'Invalid payment date', field: 'paymentDate' }, { status: 422 })
    // A payment cannot be received on a day that has not happened yet (Asia/Dhaka).
    if (dhakaDayKey(parsedDate) > dhakaDayKey(new Date()))
      return NextResponse.json({ error: 'The payment date cannot be in the future', field: 'paymentDate' }, { status: 422 })

    const isAdmin = canDo(session, 'finance.payments.confirm')
    const txnId = isAdmin ? str(bodyTxnId, 100) : null
    txnIdForError = txnId

    // Resolve which invoice this payment settles. A project can carry many
    // invoices now, so when the caller doesn't name one we apply the payment to
    // the OLDEST invoice that still has an outstanding balance — the usual
    // "clear the oldest debt first" convention. A settled invoice is never
    // auto-linked; with nothing outstanding the payment stays project-level and
    // is checked against the project balance below.
    let linkedInvoice = null
    if (!bodyInvoiceId) {
      const candidates = await Invoice.find({
        ...projectInvoiceFilter(params.id),
        clientId: project.clientId,
        status: { $in: PAYABLE_INVOICE_STATUSES },
      }).select('_id total paidAmount').sort({ issueDate: 1, createdAt: 1 }).lean()

      const pick = candidates.find(i => (Number(i.total ?? 0) - Number(i.paidAmount ?? 0)) > 0.01) ?? null
      if (pick) linkedInvoice = await Invoice.findById(pick._id).lean()
    } else {
      // The named invoice must be a payable invoice of THIS project (and of its client).
      if (!isValidObjectId(bodyInvoiceId)) return NextResponse.json({ error: 'Invalid invoiceId' }, { status: 400 })
      linkedInvoice = await Invoice.findOne({
        _id: bodyInvoiceId,
        ...projectInvoiceFilter(params.id),
        clientId: project.clientId,
        status: { $nin: ['CANCELLED', 'DRAFT'] },
      }).lean()
      if (!linkedInvoice) return NextResponse.json({ error: 'Invoice not found for this project' }, { status: 422 })
      if (!PAYABLE_INVOICE_STATUSES.includes(linkedInvoice.status))
        return NextResponse.json({ error: `${invoiceLabel(linkedInvoice)} is already ${String(linkedInvoice.status).toLowerCase()}` }, { status: 422 })
    }
    const invoiceId = linkedInvoice?._id ?? null

    // Currency: an invoice payment is always in the invoice's currency.
    let currency = String(bodyCurrency || project.currency || BASE_CURRENCY).toUpperCase()
    if (linkedInvoice) {
      const invCurrency = String(linkedInvoice.currency || BASE_CURRENCY).toUpperCase()
      if (bodyCurrency && String(bodyCurrency).toUpperCase() !== invCurrency)
        return NextResponse.json({ error: `${invoiceLabel(linkedInvoice)} is in ${invCurrency}; record the payment in ${invCurrency}` }, { status: 422 })
      currency = invCurrency
    }
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Unsupported currency' }, { status: 422 })

    // Withholding needs a BDT invoice; VDS is capped at the invoice VAT (less the VDS
    // already in pending requests, as the balance check below does); TDS section must exist.
    try {
      const pendingVds = linkedInvoice && w.vdsAmount > 0 ? await pendingVdsTotal(linkedInvoice._id) : 0
      await assertWithholdingAllowed(linkedInvoice, w, { date: parsedDate, pendingVds })
    } catch (err) {
      const res = errorJson(err)
      if (res) return res
      throw err
    }

    // BDT-equivalent. For foreign currency the BDT actually received must be given
    // (required to confirm; optional on a pending request — the confirmer sets it).
    let bdt = null
    if (!(cashAmt > 0)) {
      bdt = 0
    } else if (currency === BASE_CURRENCY) {
      bdt = cashAmt
    } else if (amountBDT != null && amountBDT !== '') {
      bdt = Number(amountBDT)
      if (!Number.isFinite(bdt) || bdt <= 0)
        return NextResponse.json({ error: 'Invalid BDT amount' }, { status: 422 })
      bdt = round2(bdt)
    }
    if (isAdmin && bdt == null)
      return NextResponse.json({ error: `Enter the BDT amount received for this ${currency} payment` }, { status: 422 })

    // Outstanding balance check — invoice balance, else project balance. Money in
    // pending requests is already claimed, so it is subtracted too.
    const settled = round2(cashAmt + withheld)
    if (linkedInvoice) {
      const pending     = await pendingPaymentTotal({ invoiceId })
      const outstanding = Math.max(0, invoiceOutstanding(linkedInvoice) - pending)
      if (settled > outstanding + 0.01) {
        return NextResponse.json(
          { error: `Amount${withheld > 0 ? ' plus tax withheld' : ''} exceeds outstanding invoice balance of ${currency} ${outstanding.toFixed(2)}${pending > 0 ? ' (after pending payment requests)' : ''}` },
          { status: 422 }
        )
      }
    } else {
      const budget  = Number(project.budget ?? 0)
      const paid    = Number(project.paidAmount ?? 0)
      const pending = await pendingPaymentTotal({ projectId: project._id })
      const outstanding = Math.max(0, budget - paid - pending)
      const checkAmt = bdt ?? cashAmt
      if (budget > 0 && checkAmt > outstanding + 0.01) {
        return NextResponse.json(
          { error: `Amount exceeds outstanding project balance of BDT ${outstanding.toFixed(2)}${pending > 0 ? ' (after pending payment requests)' : ''}` },
          { status: 422 }
        )
      }
    }

    // Money account (confirmers must name it after go-live; requesters may suggest one).
    const accountRef = cashAmt > 0 ? (str(bodyAccountId, 64) || null) : null
    try {
      if (accountRef) await loadPostingAccount(accountRef, { currency, date: parsedDate })
      if (isAdmin) await preflightPosting({ date: parsedDate, accountId: accountRef, cash: cashAmt })
    } catch (err) {
      const res = errorJson(err)
      if (res) return res
      throw err
    }
    if (txnId && await Transaction.exists({ txnId }))
      return NextResponse.json({ error: `Transaction ID "${txnId}" is already used by another ledger entry` }, { status: 409 })

    const method = cashAmt > 0 ? (str(paymentMethod, 40) ?? 'BANK_TRANSFER') : WITHHOLDING_PAYMENT_METHOD
    const paymentData = {
      projectId:          project._id,
      invoiceId:          invoiceId || null,
      clientId:           project.clientId,
      submittedBy:        session.user.id,
      amount:             cashAmt,
      currency,
      amountBDT:          bdt,
      paymentMethod:      method,
      channel:            cashAmt > 0 ? normalizeChannel(bodyChannel) : null,
      accountId:          accountRef,
      paymentDate:        parsedDate,
      description:        str(description, 500),
      notes:              str(notes, 2000),
      receiptUrl:         str(receiptUrl, 1000),
      vdsAmount:          w.vdsAmount,
      tdsAmount:          w.tdsAmount,
      tdsSection:         w.tdsSection,
      vdsCertificateNo:   w.vdsCertificateNo,
      vdsCertificateDate: w.vdsCertificateDate,
      tdsCertificateNo:   w.tdsCertificateNo,
      tdsCertificateDate: w.tdsCertificateDate,
      settledAmount:      linkedInvoice ? settled : cashAmt,
    }

    if (isAdmin) {
      // Confirmers confirm immediately — no separate confirmation step required.
      // The payment row is written first (tax entries reference it) and removed
      // again if the settlement cannot be booked.
      const payment = await new ProjectPayment({
        ...paymentData,
        status:        'CONFIRMED',
        confirmedBy:   session.user.id,
        confirmedAt:   new Date(),
        transactionId: null,
      }).save()

      let result
      try {
        result = await settleInvoicePayment({
          invoice:        linkedInvoice,
          projectId:      project._id,
          projectPayment: payment,
          cash:           cashAmt,
          currency,
          cashBDT:        bdt,
          withholding:    w,
          date:           parsedDate,
          paidAt:         parsedDate,
          accountId:      accountRef,
          channel:        paymentData.channel,
          cheque:         cheque && typeof cheque === 'object' ? cheque : null,
          userId:         session.user.id,
          entry: {
            category:       'Project Revenue',
            description:    settlementDescription({ cash: cashAmt, vds: w.vdsAmount, tds: w.tdsAmount, note: paymentData.description, label: project.name ?? project.projectCode }),
            reference:      project.projectCode ?? linkedInvoice?.invoiceNumber ?? null,
            clientId:       project.clientId?.toString() ?? null,
            paymentMethod:  method,
            receiptUrl:     paymentData.receiptUrl,
            txnId:          txnId || undefined,
            accountManager: session.user.id,
            createdBy:      session.user.id,
          },
        })
      } catch (err) {
        await ProjectPayment.deleteOne({ _id: payment._id, transactionId: null })
          .catch(e => console.error('[POST /api/projects/:id/payments] could not remove the unbooked payment', e))
        const mapped = httpErrorPayload(err, { txnId })
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
        throw err
      }

      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'PAYMENT',
        entity:   'PROJECT_PAYMENT',
        entityId: payment._id.toString(),
        changes:  JSON.stringify({
          projectId: project._id.toString(), invoiceId: invoiceId ? String(invoiceId) : null,
          amount: cashAmt, currency, amountBDT: bdt, vdsAmount: w.vdsAmount, tdsAmount: w.tdsAmount,
          accountId: result.transaction.accountId ? String(result.transaction.accountId) : null,
          transactionId: String(result.transaction._id), status: 'CONFIRMED',
        }),
        request,
      })

      const fresh = await ProjectPayment.findById(payment._id)
        .populate('submittedBy', 'name avatar')
        .populate('accountId', 'name type currency last4 bankName mfsProvider')
      return NextResponse.json({ data: fresh.toJSON(), settlement: settlementSummary(result) }, { status: 201 })
    }

    // Requester path: pending confirmation (the confirmer books the ledger).
    const payment = await new ProjectPayment({
      ...paymentData,
      status: 'PENDING_CONFIRMATION',
    }).save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'PROJECT_PAYMENT',
      entityId: payment._id.toString(),
      changes:  JSON.stringify({
        projectId: project._id.toString(), invoiceId: invoiceId ? String(invoiceId) : null,
        amount: cashAmt, currency, vdsAmount: w.vdsAmount, tdsAmount: w.tdsAmount, status: 'PENDING_CONFIRMATION',
      }),
      request,
    })

    await payment.populate('submittedBy', 'name avatar')
    return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
  } catch (err) {
    const mapped = httpErrorPayload(err, { txnId: txnIdForError })
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('[POST /api/projects/:id/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
