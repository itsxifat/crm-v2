export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectPayment, Transaction, Invoice } from '@/models'
import { createNotification } from '@/lib/createNotification'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { BASE_CURRENCY } from '@/lib/currencies'
import { PAYABLE_INVOICE_STATUSES, applyInvoicePayment, creditProjectPaid } from '@/lib/paymentLedger'

// Undo an atomic confirm claim when a later step fails, so the payment can be retried.
async function releaseClaim(paymentId) {
  await ProjectPayment.updateOne(
    { _id: paymentId, status: 'CONFIRMED', transactionId: null },
    { $set: { status: 'PENDING_CONFIRMATION', confirmedBy: null, confirmedAt: null } },
  )
}

// PATCH /api/project-payments/:pid  — confirm or reject
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.pid)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const payment = await ProjectPayment.findById(params.pid).populate('projectId').populate('invoiceId')
    if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (payment.status !== 'PENDING_CONFIRMATION')
      return NextResponse.json({ error: 'Payment already processed' }, { status: 409 })

    const { action, rejectionNote, txnId, accountManager, currency, amountBDT } = await request.json()

    if (action === 'confirm') {
      const project   = payment.projectId
      const invoice   = payment.invoiceId
      // populated() keeps the original id even when the invoice has since been deleted
      const invoiceId = invoice?._id ?? payment.populated('invoiceId') ?? null
      const amount    = Number(payment.amount)

      // Currency + BDT-equivalent. A foreign-currency payment MUST carry the BDT
      // actually received — falling back to the foreign amount would book USD 1,000
      // as ৳1,000 in the ledger and on the project.
      const txnCurrency = currency || payment.currency || BASE_CURRENCY
      let bdt
      if (txnCurrency === BASE_CURRENCY) {
        bdt = Number(amountBDT ?? payment.amountBDT ?? amount)
      } else {
        bdt = Number(amountBDT ?? payment.amountBDT)
        if (!Number.isFinite(bdt) || bdt <= 0)
          return NextResponse.json({ error: `Enter the BDT amount received for this ${txnCurrency} payment` }, { status: 422 })
      }
      if (!Number.isFinite(bdt) || bdt <= 0)
        return NextResponse.json({ error: 'Invalid BDT amount' }, { status: 422 })

      // Re-validate the linked invoice now — balance may have changed since submission.
      if (invoiceId) {
        if (!invoice || typeof invoice !== 'object' || !invoice.status)
          return NextResponse.json({ error: 'The linked invoice no longer exists' }, { status: 409 })
        if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status))
          return NextResponse.json({ error: `Invoice ${invoice.invoiceNumber ?? ''} is ${String(invoice.status).toLowerCase()} and cannot take this payment. Reject it instead.` }, { status: 409 })
        const outstanding = Number(invoice.total ?? 0) - Number(invoice.paidAmount ?? 0)
        if (amount > outstanding + 0.01)
          return NextResponse.json({ error: `Amount exceeds the invoice's outstanding balance of ${outstanding.toFixed(2)}` }, { status: 409 })
      }

      // The typed reference goes into the ledger's unique txnId — refuse a reused one clearly.
      if (txnId && await Transaction.exists({ txnId }))
        return NextResponse.json({ error: `Transaction ID "${txnId}" is already used by another ledger entry` }, { status: 409 })

      // Atomically claim the payment: only one confirm can move it out of PENDING.
      const now = new Date()
      const claimed = await ProjectPayment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING_CONFIRMATION' },
        { $set: {
          status: 'CONFIRMED', confirmedBy: session.user.id, confirmedAt: now,
          currency: txnCurrency, amountBDT: bdt,
        } },
        { new: true },
      )
      if (!claimed) return NextResponse.json({ error: 'Payment already processed' }, { status: 409 })

      let tx
      try {
        tx = await new Transaction({
          type:           'INCOME',
          category:       'Project Revenue',
          amount,
          currency:       txnCurrency,
          amountBDT:      bdt,
          description:    `Payment received${payment.description ? ': ' + payment.description : ''} — ${project?.name ?? (invoice?.invoiceNumber ?? 'Invoice')}`,
          date:           payment.paymentDate,
          reference:      project?.projectCode ?? invoice?.invoiceNumber ?? null,
          projectId:      project?._id ?? project ?? null,
          invoiceId,
          clientId:       payment.clientId?.toString() ?? null,
          paymentMethod:  payment.paymentMethod,
          receiptUrl:     payment.receiptUrl ?? null,
          txnId:          txnId || undefined,
          accountManager: accountManager || session.user.id,
          createdBy:      session.user.id,
        }).save()
      } catch (err) {
        await releaseClaim(payment._id)
        if (err?.code === 11000)
          return NextResponse.json({ error: `Transaction ID "${txnId}" is already used by another ledger entry` }, { status: 409 })
        throw err
      }

      // ── Auto-update linked invoice (atomic; fails if the balance no longer fits) ──
      if (invoiceId) {
        const updated = await applyInvoicePayment(invoiceId, amount, now)
        if (!updated) {
          await Transaction.deleteOne({ _id: tx._id })
          await releaseClaim(payment._id)
          return NextResponse.json({ error: 'The invoice was paid or changed in the meantime — this payment no longer fits its balance' }, { status: 409 })
        }
      }

      await ProjectPayment.updateOne({ _id: payment._id }, { $set: { transactionId: tx._id } })
      claimed.transactionId = tx._id

      // ── Sync paidAmount on Project (BDT — project value is tracked in BDT) ──
      if (project) await creditProjectPaid(project._id ?? project, bdt)

      // Notify requester
      if (payment.submittedBy && payment.submittedBy.toString() !== session.user.id) {
        await createNotification({
          userId:  payment.submittedBy.toString(),
          title:   'Payment confirmed',
          message: `Your payment of ${txnCurrency === BASE_CURRENCY ? '৳' : txnCurrency + ' '}${amount.toLocaleString()} has been confirmed.`,
          type:    'PAYMENT',
          link:    invoiceId ? `/admin/invoices/${invoiceId}` : '/admin/accounts',
        })
      }

      return NextResponse.json({ data: claimed.toJSON() })
    }

    if (action === 'reject') {
      const rejected = await ProjectPayment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING_CONFIRMATION' },
        { $set: {
          status: 'REJECTED', confirmedBy: session.user.id, confirmedAt: new Date(),
          rejectionNote: rejectionNote || null,
        } },
        { new: true },
      )
      if (!rejected) return NextResponse.json({ error: 'Payment already processed' }, { status: 409 })

      // Notify requester
      if (payment.submittedBy && payment.submittedBy.toString() !== session.user.id) {
        await createNotification({
          userId:  payment.submittedBy.toString(),
          title:   'Payment rejected',
          message: `Your payment request was rejected.${rejectionNote ? ' Note: ' + rejectionNote : ''}`,
          type:    'PAYMENT',
          link:    '/admin/accounts',
        })
      }

      return NextResponse.json({ data: rejected.toJSON() })
    }

    return NextResponse.json({ error: 'Invalid action. Use "confirm" or "reject".' }, { status: 400 })
  } catch (err) {
    console.error('[PATCH /api/project-payments/:pid]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
