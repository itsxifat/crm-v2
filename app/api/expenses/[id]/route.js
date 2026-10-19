export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense, TaxEntry } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import {
  payExpenseNow, authorizeExpense, unwindExpenseLinks, payeeProfilesFor, expenseSettlement, markPurchaseBillPaid,
  reverseExpensePayment, inputVatOutcomesFor,
} from '@/lib/expensePayment'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'

const ACCOUNT_FIELDS = 'name type bankName last4 mfsProvider currency status'

/** Map a library error (with .status) to a JSON response; anything else is a 500. */
function errorResponse(err, tag) {
  if (err?.status && err.status < 500) {
    return NextResponse.json({
      error: err.message,
      ...(err.details && { details: err.details }),
      ...(err.field && { field: err.field }),
      ...(typeof err.code === 'string' && { code: err.code }),
    }, { status: err.status })
  }
  console.error(tag, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

// GET /api/expenses/:id — single expense (staff; non-confirmers only see their own).
// Everyone gets `settlement` (gross / VAT / VDS / TDS / net, in BDT too) and
// `inputVat` (the input-VAT credit the payment recorded; null when unpaid / no VAT).
// Confirmers also get `payee` (tax profile of the payee, for the payment form) and
// the tax entries.
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const expense = await ProjectExpense.findById(params.id)
      .populate('submittedBy', 'name avatar email')
      .populate('reviewedBy', 'name')
      .populate('paidBy', 'name')
      .populate({ path: 'projectId', select: 'name venture projectCode' })
      .populate({ path: 'accountId', select: ACCOUNT_FIELDS })
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Non-confirmers may only read their own submissions.
    const canConfirm = canDo(session, 'finance.payments.confirm')
    if (!canConfirm && String(expense.submittedBy?._id ?? expense.submittedBy) !== session.user.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const data = expense.toJSON()
    data.settlement = expenseSettlement(expense)
    delete data.settlement.tax
    // Input-VAT credit the payment recorded (may differ from the requested tax.vatCreditable).
    data.inputVat = (await inputVatOutcomesFor([expense])).get(String(expense._id)) ?? null

    if (canConfirm) {
      const [profiles, taxEntries] = await Promise.all([
        payeeProfilesFor([expense]),
        TaxEntry.find({ expenseId: expense._id })
          .select('entryNo entryType status amount baseAmount rate creditable nonCreditReason section treatment certificate deposit date')
          .sort({ createdAt: 1 })
          .lean(),
      ])
      data.payee = profiles.get(String(expense._id)) ?? null
      data.taxEntries = taxEntries.map(({ _id, ...rest }) => ({ ...rest, id: String(_id) }))
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/expenses/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/expenses/:id — pay | authorize | reject | reverse (finance.payments.confirm)
//
// pay body: { action:'pay', paymentMethod, accountId, channel, paidAt:'YYYY-MM-DD',
//   paymentTxnId | paymentProofUrl (one required), cheque:{no,date,bank}, currency, amountBDT,
//   note, accountManager, tax:{ vatAmount, vatRate, vatCreditable, treatment, supplierBin,
//   supplierVatType, mushakNo, mushakDate, vatServiceCode, vdsRate, vdsAmount, tdsSection,
//   tdsRate, tdsAmount, tdsBase, payeeType, hasPsr, higherRateApplied, taxDeductible } }
// → { data: expense, transaction, taxEntries, warnings }  (see lib/expensePayment.payExpenseNow)
//
// reverse body: { action:'reverse', reason (≥ 5 characters) } — PAID / AUTHORIZED → PENDING:
// reversing ledger entry (today), the payment's tax entries voided, project cost / freelancer
// request / salary payout put back. 409 when a tax entry is filed, deposited or certified,
// the books are locked, or the expense belongs to a purchase bill.
// → { data: expense, reversal, voidedTaxEntries, warnings }  (see lib/expensePayment.reverseExpensePayment)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const { action, note, signedInvoiceUrl } = body

    // ─── PAY ─── PENDING → PAID. The payment has been made; record it (account,
    // date, method, txn id / proof, tax withheld), create the ledger entry and the
    // tax entries, and make the paid invoice printable.
    if (action === 'pay') {
      const result = await payExpenseNow(params.id, body, session, { requireProof: true, request })
      // A purchase bill's payment request paid here: the bill shows PAID at once.
      await markPurchaseBillPaid(result.expense)
      const txn = result.transaction
      return NextResponse.json({
        data: result.expense.toJSON(),
        transaction: txn ? {
          id:            txn._id.toString(),
          txnId:         txn.txnId ?? null,
          kind:          txn.kind,
          amount:        Number(txn.amount),
          currency:      txn.currency,
          amountBDT:     txn.amountBDT,
          plAmountBDT:   txn.plAmountBDT,
          accountId:     txn.accountId ? txn.accountId.toString() : null,
          accountAmount: txn.accountAmount ?? null,
          channel:       txn.channel ?? null,
          date:          txn.date,
          tax:           txn.tax ?? null,
        } : null,
        taxEntries: result.taxEntries.map(({ _id, ...rest }) => ({ ...rest, id: String(_id) })),
        warnings:   result.warnings,
      })
    }

    // ─── REVERSE ─── PAID / AUTHORIZED → PENDING. Undo a recorded payment so it
    // can be paid again correctly (wrong VDS / TDS / account / amount…).
    if (action === 'reverse') {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (reason.length < 5) {
        return NextResponse.json({ error: 'Give a reason for reversing the payment (at least 5 characters)', field: 'reason' }, { status: 422 })
      }
      const result = await reverseExpensePayment(params.id, { reason, session, request })
      const rev = result.reversal
      return NextResponse.json({
        data: result.expense.toJSON(),
        reversal: rev ? {
          id:        rev._id.toString(),
          txnId:     rev.txnId ?? null,
          type:      rev.type,
          amount:    Number(rev.amount),
          currency:  rev.currency,
          amountBDT: rev.amountBDT,
          accountId: rev.accountId ? rev.accountId.toString() : null,
          date:      rev.date,
        } : null,
        voidedTaxEntries: result.voidedEntries,
        warnings:         result.warnings,
      })
    }

    const expense = await ProjectExpense.findById(params.id)
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // ─── AUTHORIZE ─── PAID → AUTHORIZED. Requires the scan of the printed &
    // authorized (signed & sealed) invoice. No ledger change.
    if (action === 'authorize') {
      if (expense.status !== 'PAID') return NextResponse.json({ error: 'Only paid expenses can be authorized' }, { status: 422 })
      const scan = signedInvoiceUrl ?? expense.signedInvoiceUrl
      if (!scan) return NextResponse.json({ error: 'Upload the scan of the authorized (signed & sealed) invoice' }, { status: 422 })
      if (typeof scan !== 'string' || scan.length > 1000) return NextResponse.json({ error: 'Invalid scan reference' }, { status: 422 })

      await authorizeExpense(expense, { userId: session.user.id, signedInvoiceUrl: scan })
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'APPROVE',
        entity:   'EXPENSE',
        entityId: expense._id.toString(),
        changes:  JSON.stringify({ expenseId: expense.expenseId ?? null, voucherNo: expense.expenseInvoiceNo ?? null, status: { from: 'PAID', to: 'AUTHORIZED' } }),
        request,
      })
      return NextResponse.json({ data: expense.toJSON() })
    }

    // ─── REJECT ─── only before payment (nothing to reverse in the ledger).
    // Linked salary slip / freelancer payment request / salary payout are
    // unwound so they don't get stuck behind a rejected expense.
    if (action === 'reject') {
      const reviewNote = typeof note === 'string' ? note.trim().slice(0, 2000) || null : null
      const rejected = await ProjectExpense.findOneAndUpdate(
        { _id: expense._id, status: 'PENDING' },
        { $set: { status: 'REJECTED', reviewedBy: session.user.id, reviewedAt: new Date(), reviewNote } },
        { new: true },
      )
      if (!rejected) return NextResponse.json({ error: 'Only pending expenses can be rejected' }, { status: 422 })
      await unwindExpenseLinks(rejected)
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'REJECT',
        entity:   'EXPENSE',
        entityId: rejected._id.toString(),
        changes:  JSON.stringify({ expenseId: rejected.expenseId ?? null, title: rejected.title, status: { from: 'PENDING', to: 'REJECTED' }, note: reviewNote }),
        request,
      })
      return NextResponse.json({ data: rejected.toJSON() })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 422 })
  } catch (err) {
    return errorResponse(err, '[PATCH /api/expenses/:id]')
  }
}

// DELETE /api/expenses/:id — remove an expense that was never paid (PENDING or
// REJECTED). A PAID / AUTHORIZED expense already has a ledger entry and settled
// linked records (salary slip, payout, freelancer assignment); deleting it would
// leave the books inconsistent, so its payment must be reversed first (PATCH
// action 'reverse', which posts the counter-entry and puts it back to PENDING).
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const expense = await ProjectExpense.findOneAndDelete({ _id: params.id, status: { $in: ['PENDING', 'REJECTED'] } })
    if (!expense) {
      const exists = await ProjectExpense.exists({ _id: params.id })
      if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ error: 'A paid or authorized expense cannot be deleted — reverse its payment first (it goes back to Pending), then delete it' }, { status: 409 })
    }
    await unwindExpenseLinks(expense)
    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'EXPENSE',
      entityId: expense._id.toString(),
      changes:  JSON.stringify({ expenseId: expense.expenseId ?? null, title: expense.title, amount: expense.amount, currency: expense.currency, status: expense.status }),
      request,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/expenses/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
