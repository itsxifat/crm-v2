export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CreditNote, TaxEntry, Transaction } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { z } from 'zod'
import { cancelNote, limitsForInvoice, NOTE_VIEW_PERMS } from '../_lib/creditNotes'

const POPULATE = [
  { path: 'invoiceId', select: 'invoiceNumber status currency total paidAmount vatTreatment issuedAt issueDate creditedAmount debitedAmount' },
  { path: 'clientId', select: 'company clientCode userId', populate: { path: 'userId', select: 'name' } },
  { path: 'createdBy', select: 'name' },
  { path: 'cancelledBy', select: 'name' },
  { path: 'refundAccountId', select: 'name type last4 currency' },
]

// GET /api/credit-notes/[id] — note + its tax entry, refund transaction and invoice limits
export async function GET(_request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, NOTE_VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const note = await CreditNote.findById(params.id).populate(POPULATE)
    if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [taxEntry, transaction, reversal, context] = await Promise.all([
      note.taxEntryId ? TaxEntry.findById(note.taxEntryId).select('entryNo status period amount sdAmount baseAmount filingId voidReason').lean() : null,
      note.transactionId ? Transaction.findById(note.transactionId).select('txnId amount currency date accountId').populate('accountId', 'name type last4').lean() : null,
      note.transactionId ? Transaction.findOne({ reversalOf: note.transactionId }).select('txnId date amount').lean() : null,
      limitsForInvoice(note.invoiceId?._id ?? note.invoiceId),
    ])

    const out = (doc) => (doc ? { ...doc, id: String(doc._id), _id: undefined } : null)
    return NextResponse.json({
      data: note.toJSON(),
      taxEntry: out(taxEntry),
      transaction: transaction ? { ...out(transaction), accountId: transaction.accountId ? { ...transaction.accountId, id: String(transaction.accountId._id), _id: undefined } : null } : null,
      reversal: out(reversal),
      context,
    })
  } catch (err) {
    console.error('[GET /api/credit-notes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const putSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }),
  z.object({ action: z.literal('update'), reasonText: z.string().trim().max(1000).nullable() }),
])

// PUT /api/credit-notes/[id]
//   { action: 'cancel', reason }      reverse the note's effects (latest note first)
//   { action: 'update', reasonText }  edit the free-text explanation of an ISSUED note
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.notes.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const parsed = putSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    if (parsed.data.action === 'update') {
      const existing = await CreditNote.findById(params.id).select('status reasonText reason noteNo').lean()
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (existing.status !== 'ISSUED') return NextResponse.json({ error: 'A cancelled note cannot be edited' }, { status: 409 })
      const reasonText = parsed.data.reasonText || null
      if (existing.reason === 'OTHER' && !reasonText)
        return NextResponse.json({ error: 'Describe the reason for the note' }, { status: 422 })
      const updated = await CreditNote.findOneAndUpdate(
        { _id: params.id, status: 'ISSUED' },
        { $set: { reasonText } },
        { new: true },
      ).populate(POPULATE)
      if (!updated) return NextResponse.json({ error: 'A cancelled note cannot be edited' }, { status: 409 })
      logActivity({
        userId: session.user.id, userRole: session.user.role, action: 'UPDATE', entity: 'CREDIT_NOTE',
        entityId: params.id,
        changes: JSON.stringify({ noteNo: existing.noteNo, reasonText: { from: existing.reasonText ?? null, to: reasonText } }),
        request,
      })
      return NextResponse.json({ data: updated.toJSON() })
    }

    let result
    try {
      result = await cancelNote(params.id, { reason: parsed.data.reason, userId: session.user.id })
    } catch (err) {
      if (err.status) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }

    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'VOID', entity: 'CREDIT_NOTE',
      entityId: params.id,
      changes: JSON.stringify({
        noteNo: result.note.noteNo,
        kind: result.note.kind,
        invoiceNumber: result.note.invoiceNumber,
        totalAmount: result.note.totalAmount,
        reason: parsed.data.reason,
        ...(result.reversal ? { reversal: result.reversal.txnId } : {}),
      }),
      request,
    })

    const fresh = await CreditNote.findById(params.id).populate(POPULATE)
    return NextResponse.json({
      data: (fresh ?? result.note).toJSON(),
      reversal: result.reversal ? { id: result.reversal._id.toString(), txnId: result.reversal.txnId } : null,
    })
  } catch (err) {
    console.error('[PUT /api/credit-notes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
