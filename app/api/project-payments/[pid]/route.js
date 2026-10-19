export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectPayment, Transaction, Invoice, Project } from '@/models'
import { createNotification } from '@/lib/createNotification'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { BASE_CURRENCY, isValidCurrency, formatMoney } from '@/lib/currencies'
import { maskDoc, INVOICE_PII } from '@/lib/pii'
import { dhakaDayKey } from '@/lib/dhakaTime'
import {
  PAYABLE_INVOICE_STATUSES, WITHHOLDING_PAYMENT_METHOD,
  readWithholding, hasWithholding, withheldTotal, invoiceOutstanding, invoiceLabel,
  assertWithholdingAllowed, loadPostingAccount, preflightPosting, parseBusinessDate,
  settleInvoicePayment, settlementSummary, settlementDescription, httpErrorPayload, round2,
  reverseClientSettlement,
} from '@/lib/paymentLedger'
import { z } from 'zod'

const optStr = (max) => z.string().max(max).optional().nullable()
const optMoney = z.union([z.number(), z.string()]).optional().nullable()

const bodySchema = z.object({
  action:             z.enum(['confirm', 'reject', 'reverse']),
  // reverse only: why the confirmed payment is being undone (5–500 characters)
  reason:             z.string().trim().max(500).optional().nullable(),
  rejectionNote:      optStr(1000),
  txnId:              optStr(100),
  accountManager:     optStr(64),
  currency:           optStr(8),
  amountBDT:          optMoney,
  paymentDate:        optStr(40),
  // money account & instrument
  accountId:          optStr(64),
  channel:            optStr(40),
  cheque:             z.object({ no: optStr(60), date: optStr(40), bank: optStr(120) }).optional().nullable(),
  // tax withheld by the client (BDT invoices only); omitted keys keep the values on the request
  vdsAmount:          optMoney,
  tdsAmount:          optMoney,
  tdsSection:         optStr(40),
  vdsCertificateNo:   optStr(100),
  vdsCertificateDate: optStr(40),
  tdsCertificateNo:   optStr(100),
  tdsCertificateDate: optStr(40),
})

// Undo an atomic confirm claim when a later step fails, so the payment can be retried.
async function releaseClaim(paymentId) {
  await ProjectPayment.updateOne(
    { _id: paymentId, status: 'CONFIRMED', transactionId: null },
    { $set: { status: 'PENDING_CONFIRMATION', confirmedBy: null, confirmedAt: null } },
  )
}

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status })

// PATCH /api/project-payments/:pid  — confirm or reject a pending payment, or
// reverse a confirmed one: { action:'reverse', reason } posts a reversing ledger
// entry (dated today), voids its VDS / TDS receivables, takes cash + VDS + TDS
// back off the invoice and the P&L amount off the project, and marks the
// payment REVERSED so it can be recorded again with the right details.
export async function PATCH(request, { params }) {
  let txnIdForError = null
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.pid)) return fail('Not found', 404)
    await connectDB()

    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    const body = parsed.data

    const payment = await ProjectPayment.findById(params.pid)
    if (!payment) return fail('Not found', 404)

    // ── reverse a confirmed payment ──
    if (body.action === 'reverse') {
      const reason = body.reason?.trim() || ''
      if (reason.length < 5) return fail('Give a reason for reversing the payment (at least 5 characters)', 422, { field: 'reason' })
      const fromStatus = payment.status
      let result
      try {
        result = await reverseClientSettlement({ paymentId: payment._id, reason, userId: session.user.id })
      } catch (err) {
        const mapped = httpErrorPayload(err)
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
        throw err
      }

      if (payment.submittedBy && payment.submittedBy.toString() !== session.user.id) {
        const amount = round2(Number(payment.amount) || 0)
        const money = amount > 0 ? formatMoney(amount, payment.currency || BASE_CURRENCY) : formatMoney(round2(result.vds + result.tds), 'BDT')
        await createNotification({
          userId:  payment.submittedBy.toString(),
          title:   'Payment reversed',
          message: `The confirmed payment of ${money}${result.invoice ? ` on ${invoiceLabel(result.invoice)}` : ''} was reversed. Reason: ${reason}`,
          type:    'PAYMENT',
          link:    payment.invoiceId ? `/admin/invoices/${payment.invoiceId}` : '/admin/accounts?tab=confirmations',
        }).catch(err => console.error('[PATCH /api/project-payments/:pid] notification failed', err))
      }

      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'REVERSE',
        entity:   'PROJECT_PAYMENT',
        entityId: payment._id.toString(),
        changes:  JSON.stringify({
          status:            { from: fromStatus, to: 'REVERSED' },
          reason,
          amount:            Number(payment.amount) || 0,
          currency:          payment.currency || BASE_CURRENCY,
          vdsAmount:         result.vds,
          tdsAmount:         result.tds,
          settled:           result.settled,
          invoiceId:         payment.invoiceId ? String(payment.invoiceId) : null,
          invoiceStatus:     result.invoice ? result.invoice.status : null,
          transaction:       result.transaction.txnId ?? String(result.transaction._id),
          reversal:          result.reversal?.txnId ?? (result.reversal ? String(result.reversal._id) : null),
          taxEntriesVoided:  result.voidedEntries.map(v => v.entryNo),
          projectId:         result.projectId,
          projectReducedBDT: result.projectReducedBDT,
        }),
        request,
      })

      const fresh = await ProjectPayment.findById(payment._id)
        .populate('accountId', 'name type currency last4 bankName mfsProvider')
        .populate('confirmedBy', 'name')
        .populate('reversedBy', 'name')
      return NextResponse.json({
        data: maskDoc(session, fresh.toJSON(), INVOICE_PII),
        reversal: {
          transaction:   result.reversal ? { id: String(result.reversal._id), txnId: result.reversal.txnId ?? null } : null,
          voidedEntries: result.voidedEntries,
          invoice:       result.invoice ? {
            id:          String(result.invoice._id),
            status:      result.invoice.status,
            paidAmount:  Number(result.invoice.paidAmount) || 0,
            total:       Number(result.invoice.total) || 0,
            withheldVds: Number(result.invoice.withheldVds) || 0,
            withheldTds: Number(result.invoice.withheldTds) || 0,
          } : null,
          projectReducedBDT: result.projectReducedBDT,
        },
      })
    }

    if (payment.status !== 'PENDING_CONFIRMATION') return fail('Payment already processed', 409)

    if (body.action === 'confirm') {
      const txnId = body.txnId?.trim() || null
      txnIdForError = txnId
      const project = payment.projectId
        ? await Project.findById(payment.projectId).select('name projectCode').lean()
        : null
      const invoiceId = payment.invoiceId ?? null
      const invoice = invoiceId ? await Invoice.findById(invoiceId).lean() : null
      const amount = round2(Number(payment.amount) || 0)
      if (amount < 0) return fail('This payment has a negative amount and cannot be confirmed — reject it instead', 409)

      // Withholding: body keys override what the requester entered.
      let w
      try { w = readWithholding(body, payment.toObject()) } catch (err) { return fail(err.message, err.status ?? 422, err.field ? { field: err.field } : {}) }
      const withheld = withheldTotal(w)
      if (!(amount > 0) && !(withheld > 0))
        return fail('This request has no amount and no tax withheld — reject it instead', 422)

      // Currency + BDT-equivalent. A foreign-currency payment MUST carry the BDT
      // actually received — falling back to the foreign amount would book USD 1,000
      // as ৳1,000 in the ledger and on the project.
      const txnCurrency = String(body.currency || payment.currency || BASE_CURRENCY).toUpperCase()
      if (!isValidCurrency(txnCurrency)) return fail('Unsupported currency', 422)
      if (invoice && txnCurrency !== String(invoice.currency || BASE_CURRENCY).toUpperCase())
        return fail(`${invoiceLabel(invoice)} is in ${invoice.currency || BASE_CURRENCY}; the payment must be in the same currency`, 422)
      let bdt = 0
      if (amount > 0) {
        if (txnCurrency === BASE_CURRENCY) {
          bdt = amount
        } else {
          bdt = Number(body.amountBDT ?? payment.amountBDT)
          if (!Number.isFinite(bdt) || bdt <= 0)
            return fail(`Enter the BDT amount received for this ${txnCurrency} payment`, 422, { field: 'amountBDT' })
          bdt = round2(bdt)
        }
      } else if (txnCurrency !== BASE_CURRENCY) {
        return fail('Tax withheld at source can only be recorded on BDT payments', 422)
      }

      // Re-validate the linked invoice now — balance may have changed since submission.
      if (invoiceId) {
        if (!invoice) return fail('The linked invoice no longer exists', 409)
        if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status))
          return fail(`${invoiceLabel(invoice)} is ${String(invoice.status).toLowerCase()} and cannot take this payment. Reject it instead.`, 409)
        const outstanding = invoiceOutstanding(invoice)
        const settled = round2(amount + withheld)
        if (settled > outstanding + 0.01)
          return fail(`Amount${withheld > 0 ? ' plus tax withheld' : ''} exceeds the invoice's outstanding balance of ${outstanding.toFixed(2)}`, 409)
      }

      // Payment date (optional correction by the confirmer).
      let paymentDate = payment.paymentDate ?? new Date()
      if (body.paymentDate) {
        paymentDate = parseBusinessDate(body.paymentDate)
        if (!paymentDate) return fail('Invalid payment date', 422, { field: 'paymentDate' })
      }
      // Money cannot be received on a day that has not happened yet (Asia/Dhaka).
      // Also catches a future date typed on the request — the confirmer corrects it.
      if (dhakaDayKey(paymentDate) > dhakaDayKey(new Date()))
        return fail('The payment date cannot be in the future', 422, { field: 'paymentDate' })

      // Money account: the confirmer's choice, else the one suggested on the request.
      const accountRef = amount > 0
        ? (body.accountId !== undefined ? (body.accountId || null) : (payment.accountId ? String(payment.accountId) : null))
        : null

      try {
        await assertWithholdingAllowed(invoice, w, { date: paymentDate })
        if (amount > 0) await loadPostingAccount(accountRef, { currency: txnCurrency, date: paymentDate })
        await preflightPosting({ date: paymentDate, accountId: accountRef, cash: amount })
      } catch (err) {
        const mapped = httpErrorPayload(err)
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
        throw err
      }

      // The typed reference goes into the ledger's unique txnId — refuse a reused one clearly.
      if (txnId && await Transaction.exists({ txnId }))
        return fail(`Transaction ID "${txnId}" is already used by another ledger entry`, 409)

      // Atomically claim the payment: only one confirm can move it out of PENDING.
      const now = new Date()
      const claimed = await ProjectPayment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING_CONFIRMATION' },
        { $set: {
          status: 'CONFIRMED', confirmedBy: session.user.id, confirmedAt: now,
          currency: txnCurrency, amountBDT: amount > 0 ? bdt : 0,
        } },
        { new: true },
      )
      if (!claimed) return fail('Payment already processed', 409)

      const label = project?.name ?? invoice?.invoiceNumber ?? 'Invoice'
      let result
      try {
        result = await settleInvoicePayment({
          invoice,
          projectId:      project?._id ?? payment.projectId ?? null,
          projectPayment: claimed,
          cash:           amount,
          currency:       txnCurrency,
          cashBDT:        bdt,
          withholding:    w,
          date:           paymentDate,
          paidAt:         now,
          accountId:      accountRef,
          channel:        body.channel || null,
          cheque:         body.cheque || null,
          userId:         session.user.id,
          entry: {
            category:       'Project Revenue',
            description:    settlementDescription({ cash: amount, vds: w.vdsAmount, tds: w.tdsAmount, note: payment.description, label }),
            reference:      project?.projectCode ?? invoice?.invoiceNumber ?? null,
            clientId:       payment.clientId ? String(payment.clientId) : null,
            paymentMethod:  amount > 0 ? (payment.paymentMethod || 'BANK_TRANSFER') : WITHHOLDING_PAYMENT_METHOD,
            receiptUrl:     payment.receiptUrl ?? null,
            txnId:          txnId || undefined,
            accountManager: body.accountManager && isValidObjectId(body.accountManager) ? body.accountManager : session.user.id,
            createdBy:      session.user.id,
          },
          paymentLink: body.paymentDate ? { paymentDate } : {},
        })
      } catch (err) {
        await releaseClaim(payment._id)
        const mapped = httpErrorPayload(err, { txnId })
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
        throw err
      }

      // Notify requester
      if (payment.submittedBy && payment.submittedBy.toString() !== session.user.id) {
        const money = txnCurrency === BASE_CURRENCY ? `৳${amount.toLocaleString()}` : `${txnCurrency} ${amount.toLocaleString()}`
        await createNotification({
          userId:  payment.submittedBy.toString(),
          title:   'Payment confirmed',
          message: amount > 0
            ? `Your payment of ${money} has been confirmed.${hasWithholding(w) ? ` Tax withheld (${formatMoney(withheld, 'BDT')}) was recorded too.` : ''}`
            : `The tax withheld at source (${formatMoney(withheld, 'BDT')}) has been recorded.`,
          type:    'PAYMENT',
          link:    invoiceId ? `/admin/invoices/${invoiceId}` : '/admin/accounts',
        }).catch(err => console.error('[PATCH /api/project-payments/:pid] notification failed', err))
      }

      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'PAYMENT',
        entity:   'PROJECT_PAYMENT',
        entityId: payment._id.toString(),
        changes:  JSON.stringify({
          status:        { from: 'PENDING_CONFIRMATION', to: 'CONFIRMED' },
          amount, currency: txnCurrency, amountBDT: bdt,
          vdsAmount:     w.vdsAmount, tdsAmount: w.tdsAmount,
          accountId:     result.transaction.accountId ? String(result.transaction.accountId) : null,
          transactionId: String(result.transaction._id),
          invoiceId:     invoiceId ? String(invoiceId) : null,
          taxEntryIds:   result.taxEntries.map(e => String(e._id)),
        }),
        request,
      })

      const fresh = await ProjectPayment.findById(payment._id)
        .populate('accountId', 'name type currency last4 bankName mfsProvider')
        .populate('confirmedBy', 'name')
      return NextResponse.json({
        data: maskDoc(session, fresh.toJSON(), INVOICE_PII),
        settlement: settlementSummary(result),
      })
    }

    // ── reject ──
    const rejectionNote = body.rejectionNote?.trim() || null
    const rejected = await ProjectPayment.findOneAndUpdate(
      { _id: payment._id, status: 'PENDING_CONFIRMATION' },
      { $set: {
        status: 'REJECTED', confirmedBy: session.user.id, confirmedAt: new Date(),
        rejectionNote,
      } },
      { new: true },
    )
    if (!rejected) return fail('Payment already processed', 409)

    // Notify requester
    if (payment.submittedBy && payment.submittedBy.toString() !== session.user.id) {
      await createNotification({
        userId:  payment.submittedBy.toString(),
        title:   'Payment rejected',
        message: `Your payment request was rejected.${rejectionNote ? ' Note: ' + rejectionNote : ''}`,
        type:    'PAYMENT',
        link:    '/admin/accounts',
      }).catch(err => console.error('[PATCH /api/project-payments/:pid] notification failed', err))
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'REJECT',
      entity:   'PROJECT_PAYMENT',
      entityId: payment._id.toString(),
      changes:  JSON.stringify({ status: { from: 'PENDING_CONFIRMATION', to: 'REJECTED' }, amount: Number(payment.amount) || 0, rejectionNote }),
      request,
    })

    return NextResponse.json({ data: rejected.toJSON() })
  } catch (err) {
    const mapped = httpErrorPayload(err, { txnId: txnIdForError })
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('[PATCH /api/project-payments/:pid]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
