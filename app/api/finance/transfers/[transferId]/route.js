export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { z } from 'zod'
import { Transaction } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay, dhakaDayKey } from '@/lib/dhakaTime'
import { createTransfer, reverseMoneyEntry } from '@/lib/finance/ledger'
import { errorResponse } from '../../accounts/[id]/_lib/accountData'
import { findTransfer } from '../_lib/transfers'

const VIEW_PERMS = ['finance.accounts.view', 'finance.accounts.manage', 'finance.accounts.reconcile']
const ID_RE = /^[0-9a-f-]{8,64}$/i

const actionSchema = z.object({
  action:     z.literal('reverse'),
  date:       z.string({ required_error: 'Date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date'),
  reason:     z.string({ required_error: 'Give a reason' }).trim().min(5, 'Give a reason (at least 5 characters)').max(300),
  reverseFee: z.boolean().optional(),
})

// GET /api/finance/transfers/[transferId] → { data: transfer }
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!ID_RE.test(String(params.transferId ?? ''))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const transfer = await findTransfer(params.transferId)
    if (!transfer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: transfer })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/transfers/[transferId]]')
  }
}

// POST /api/finance/transfers/[transferId] { action:'reverse', date, reason, reverseFee? }
// The ledger is immutable: a wrong transfer is corrected by an opposite transfer
// (legs linked via reversalOf). The fee row is reversed too unless reverseFee:false.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.manage')
    if (denied) return denied
    if (!ID_RE.test(String(params.transferId ?? ''))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const raw = await request.json().catch(() => null)
    const parsed = actionSchema.safeParse(raw ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const { date, reason } = parsed.data
    const reverseFee = parsed.data.reverseFee !== false

    await connectDB()
    const rows = await Transaction.find({ transferId: params.transferId }).lean()
    const legs = rows.filter(r => r.kind === 'TRANSFER')
    const out = legs.find(l => l.type === 'EXPENSE')
    const inn = legs.find(l => l.type === 'INCOME')
    if (!out || !inn) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (out.reversalOf || inn.reversalOf) {
      return NextResponse.json({ error: 'This transfer is itself a reversal and cannot be reversed again' }, { status: 409 })
    }
    if (await Transaction.exists({ reversalOf: { $in: [out._id, inn._id] } })) {
      return NextResponse.json({ error: 'This transfer has already been reversed' }, { status: 409 })
    }

    const day = parseDhakaDay(date)
    if (!day) return NextResponse.json({ error: 'Use a valid date' }, { status: 422 })
    if (date > dhakaDayKey(new Date())) return NextResponse.json({ error: 'The reversal date cannot be in the future' }, { status: 422 })
    if (date < dhakaDayKey(out.date)) {
      return NextResponse.json({ error: 'The reversal cannot be dated before the original transfer' }, { status: 422 })
    }

    const outAmt = Number(out.accountAmount ?? out.amount)
    const inAmt  = Number(inn.accountAmount ?? inn.amount)
    const label  = [out.txnId, inn.txnId].filter(Boolean).join(' / ')

    // Opposite transfer: original destination → original source. The legs carry
    // reversalOf from the moment they are inserted (the new OUT leg reverses the
    // original IN leg and vice versa); the unique index on reversalOf makes a
    // concurrent second reversal fail at its first insert with a 409.
    const result = await createTransfer({
      fromAccountId: inn.accountId,
      toAccountId:   out.accountId,
      amount:        inAmt,
      toAmount:      outAmt,
      amountBDT:     out.amountBDT ?? inn.amountBDT ?? null,
      date,
      fee:           0,
      channel:       out.channel ?? null,
      reference:     out.reference ?? null,
      description:   `Reversal of transfer ${label} — ${reason}`,
      userId:        session.user.id,
      reversalOf:    { out: inn._id, in: out._id },
    })
    const [newOut, newIn] = result.legs
    const created = [newOut._id, newIn._id]

    try {
      if (reverseFee) {
        const fees = rows.filter(r => r.kind !== 'TRANSFER' && r.type === 'EXPENSE' && !r.reversalOf)
        for (const fee of fees) {
          const rev = await reverseMoneyEntry(fee._id, { userId: session.user.id, date, reason: `transfer reversed — ${reason}` })
          created.push(rev._id)
          await Transaction.updateOne({ _id: rev._id }, { $set: { transferId: result.transferId } })
        }
      }
    } catch (err) {
      await Transaction.deleteMany({ _id: { $in: created } })
        .catch(e => console.error('[transfers] reversal compensating delete failed', result.transferId, e))
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'REVERSE',
      entity:   'TRANSFER',
      entityId: params.transferId,
      changes:  JSON.stringify({ reversalTransferId: result.transferId, date, reason, reverseFee, original: label }),
      request,
    })

    return NextResponse.json({ data: await findTransfer(result.transferId) }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/transfers/[transferId]]')
  }
}
