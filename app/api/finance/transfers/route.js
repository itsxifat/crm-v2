export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { z } from 'zod'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay, dhakaDayKey } from '@/lib/dhakaTime'
import { createTransfer, PAYMENT_CHANNEL_VALUES } from '@/lib/finance/ledger'
import { errorResponse, optMoney, reqMoney } from '../accounts/[id]/_lib/accountData'
import { findTransfers, findTransfer, accountMatch } from './_lib/transfers'

// Reconcilers see the accounts, statements and reconciliations — and this read-only list on the same pages.
const VIEW_PERMS = ['finance.accounts.view', 'finance.accounts.manage', 'finance.accounts.reconcile']
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)
const optStr = (max) => z.preprocess(emptyToNull, z.string().trim().max(max, `Max ${max} characters`).nullable().optional())
const day = z.string({ required_error: 'Date is required' }).regex(DAY_RE, 'Use a valid date')

const transferSchema = z.object({
  fromAccountId: z.string({ required_error: 'Choose the account money leaves' }).refine(isValidObjectId, 'Choose the account money leaves'),
  toAccountId:   z.string({ required_error: 'Choose the account money arrives in' }).refine(isValidObjectId, 'Choose the account money arrives in'),
  amount:        reqMoney(n => n > 0, 'Amount must be greater than zero'),
  toAmount:      optMoney(n => n > 0, 'Received amount must be greater than zero'),
  amountBDT:     optMoney(n => n > 0, 'BDT value must be greater than zero'),
  date:          day,
  fee:           optMoney(n => n >= 0, 'Fee cannot be negative'),
  channel:       z.preprocess(emptyToNull, z.enum(PAYMENT_CHANNEL_VALUES).nullable().optional()),
  reference:     optStr(120),
  description:   optStr(300),
  cheque: z.object({
    no:   optStr(40),
    date: z.preprocess(emptyToNull, day.nullable().optional()),
    bank: optStr(120),
  }).nullable().optional(),
}).refine(d => d.fromAccountId !== d.toAccountId, { message: 'Choose two different accounts', path: ['toAccountId'] })

// GET /api/finance/transfers?accountId=&startDate=&endDate=&page=1&limit=20
// → { data: [{ transferId, date, from, to, amount, currency, toAmount, toCurrency, fee, channel,
//              reference, description, cheque, legs, isReversal, reversedByTransferId, createdBy }], meta }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))

    if (accountId && !isValidObjectId(accountId)) return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
    if (startDate && !parseDhakaDay(startDate)) return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 422 })
    if (endDate && !parseDhakaDay(endDate)) return NextResponse.json({ error: 'endDate must be YYYY-MM-DD' }, { status: 422 })

    await connectDB()

    const match = accountId ? accountMatch(accountId) : {}
    if (startDate || endDate) {
      match.date = {}
      if (startDate) match.date.$gte = parseDhakaDay(startDate).start
      if (endDate) match.date.$lt = parseDhakaDay(endDate).next
    }

    const { rows, total } = await findTransfers(match, { skip: (page - 1) * limit, limit })
    return NextResponse.json({ data: rows, meta: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/transfers]')
  }
}

// POST /api/finance/transfers — move money between two accounts (optional fee, cheque, FX).
// amountBDT is required when neither account is in BDT (createTransfer answers 422 on `amountBDT`).
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.manage')
    if (denied) return denied

    const raw = await request.json().catch(() => null)
    if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = transferSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data
    if (!parseDhakaDay(d.date) || d.date > dhakaDayKey(new Date())) {
      return NextResponse.json({ error: 'Transfer date cannot be in the future', details: { formErrors: [], fieldErrors: { date: ['Transfer date cannot be in the future'] } } }, { status: 422 })
    }

    await connectDB()

    const result = await createTransfer({
      fromAccountId: d.fromAccountId,
      toAccountId:   d.toAccountId,
      amount:        d.amount,
      toAmount:      d.toAmount ?? null,
      amountBDT:     d.amountBDT ?? null,
      date:          d.date,
      fee:           d.fee ?? 0,
      channel:       d.channel ?? null,
      reference:     d.reference ?? null,
      description:   d.description ?? null,
      cheque:        d.cheque ?? null,
      userId:        session.user.id,
    })

    const transfer = await findTransfer(result.transferId)

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'TRANSFER',
      entityId: result.transferId,
      changes:  JSON.stringify({
        from: transfer?.from?.name ?? d.fromAccountId,
        to: transfer?.to?.name ?? d.toAccountId,
        amount: d.amount, currency: transfer?.currency, toAmount: transfer?.toAmount, toCurrency: transfer?.toCurrency,
        fee: d.fee ?? 0, date: d.date, channel: transfer?.channel ?? d.channel ?? null, reference: d.reference ?? null,
        txnIds: [result.legs?.[0]?.txnId, result.legs?.[1]?.txnId, result.feeTx?.txnId].filter(Boolean),
      }),
      request,
    })

    return NextResponse.json({ data: transfer }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/transfers]')
  }
}
