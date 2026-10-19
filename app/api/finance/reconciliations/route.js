export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import mongoose from 'mongoose'
import { z } from 'zod'
import { MoneyAccount, Reconciliation, Transaction } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay, dhakaDayStart } from '@/lib/dhakaTime'
import { errorResponse, reqMoney } from '../accounts/[id]/_lib/accountData'
import {
  liveSummary, statementDateProblem, statementWindow, shapeRecon, userNames, round2,
} from './_lib/reconcile'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'

const VIEW_PERMS = ['finance.accounts.reconcile', 'finance.accounts.view', 'finance.accounts.manage']
const STATUSES = ['IN_PROGRESS', 'COMPLETED', 'UNDONE']

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)

const createSchema = z.object({
  accountId:        z.string({ required_error: 'Choose the account' }).refine(isValidObjectId, 'Choose the account'),
  statementDate:    z.string({ required_error: 'Statement date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid statement date'),
  statementBalance: reqMoney(null),
  notes:            z.preprocess(emptyToNull, z.string().trim().max(1000).nullable().optional()),
  attachmentUrl:    z.preprocess(emptyToNull, z.string().trim().max(500)
    .regex(UPLOAD_URL_RE, 'Attach the statement with the upload button').nullable().optional()),
})

// GET /api/finance/reconciliations?accountId=&status=&page=1&limit=20
// → { data: [reconciliation + account + canUndo], meta }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const status = searchParams.get('status')
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    if (accountId && !isValidObjectId(accountId)) return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
    if (status && !STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

    await connectDB()
    const filter = {}
    if (accountId) filter.accountId = new mongoose.Types.ObjectId(accountId)
    if (status) filter.status = status

    const [docs, total] = await Promise.all([
      Reconciliation.find(filter)
        .sort({ statementDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('accountId', 'name type currency last4 bankName mfsProvider color status')
        .lean(),
      Reconciliation.countDocuments(filter),
    ])

    // Only the latest COMPLETED session per account can be undone (and only with nothing in progress).
    const accountIds = [...new Set(docs.map(d => String(d.accountId?._id ?? d.accountId)))]
    const [latest, inProgress, users] = await Promise.all([
      accountIds.length
        ? Reconciliation.aggregate([
          { $match: { accountId: { $in: accountIds.map(id => new mongoose.Types.ObjectId(id)) }, status: 'COMPLETED' } },
          { $sort: { statementDate: -1, completedAt: -1 } },
          { $group: { _id: '$accountId', id: { $first: '$_id' } } },
        ])
        : [],
      accountIds.length
        ? Reconciliation.find({ accountId: { $in: accountIds }, status: 'IN_PROGRESS' }).select('accountId').lean()
        : [],
      userNames(docs),
    ])
    const latestByAccount = new Map(latest.map(l => [String(l._id), String(l.id)]))
    const busy = new Set(inProgress.map(r => String(r.accountId)))

    const data = docs.map(d => {
      const acc = d.accountId && typeof d.accountId === 'object' ? d.accountId : null
      const accId = String(acc?._id ?? d.accountId)
      return {
        ...shapeRecon(d, users),
        account: acc ? {
          id: accId, name: acc.name, type: acc.type, currency: acc.currency || 'BDT', last4: acc.last4 ?? null,
          bankName: acc.bankName ?? null, mfsProvider: acc.mfsProvider ?? null, color: acc.color ?? null, status: acc.status,
        } : null,
        canUndo: d.status === 'COMPLETED' && latestByAccount.get(accId) === String(d._id) && !busy.has(accId),
      }
    })

    return NextResponse.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/reconciliations]')
  }
}

// POST /api/finance/reconciliations { accountId, statementDate, statementBalance, notes?, attachmentUrl? }
// Starts an IN_PROGRESS session (one per account). Rows already marked CLEARED in the window are pre-ticked.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.reconcile')
    if (denied) return denied

    const raw = await request.json().catch(() => null)
    if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = createSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data

    await connectDB()
    const account = await MoneyAccount.findById(d.accountId).lean()
    if (!account) return NextResponse.json({ error: 'Money account not found' }, { status: 404 })
    if (account.status !== 'ACTIVE') return NextResponse.json({ error: 'Archived accounts cannot be reconciled' }, { status: 409 })

    if (await Reconciliation.exists({ accountId: account._id, status: 'IN_PROGRESS' })) {
      return NextResponse.json({ error: 'A reconciliation is already in progress for this account' }, { status: 409 })
    }
    const problem = await statementDateProblem(d.statementDate, account)
    if (problem) {
      return NextResponse.json({ error: problem, details: { formErrors: [], fieldErrors: { statementDate: [problem] } } }, { status: 422 })
    }

    let recon
    try {
      recon = await Reconciliation.create({
        accountId:        account._id,
        statementDate:    parseDhakaDay(d.statementDate).start,
        statementBalance: round2(d.statementBalance),
        status:           'IN_PROGRESS',
        notes:            d.notes ?? null,
        attachmentUrl:    d.attachmentUrl ?? null,
        transactionIds:   [],
        createdBy:        session.user.id,
      })
    } catch (err) {
      if (err?.code === 11000) {
        return NextResponse.json({ error: 'A reconciliation is already in progress for this account' }, { status: 409 })
      }
      throw err
    }

    // Pre-tick rows that are already marked cleared (e.g. after an undone reconciliation).
    const win = statementWindow(recon.statementDate, account)
    const date = { $lt: win.next }
    if (account.openingDate) date.$gte = dhakaDayStart(account.openingDate)
    const pre = await Transaction.find({ accountId: account._id, date, clearStatus: 'CLEARED', reconciliationId: null })
      .select('_id clearedDate type date amount accountAmount amountBDT currency').lean()
    if (pre.length) {
      const ids = pre.map(p => p._id)
      await Transaction.updateMany({ _id: { $in: ids }, reconciliationId: null }, { $set: { reconciliationId: recon._id } })
      recon.transactionIds = ids
      // Remember which rows were already cleared before this session — and how they
      // looked — so discarding it puts them back CLEARED with their own cleared date
      // instead of un-clearing them. strict:false keeps the write even where the
      // schema does not declare these fields (read back with recon.get(...)).
      const snapshot = pre.map(p => ({
        txId: p._id, clearedDate: p.clearedDate ?? null, type: p.type ?? null, date: p.date ?? null,
        amount: p.amount ?? null, accountAmount: p.accountAmount ?? null, amountBDT: p.amountBDT ?? null, currency: p.currency ?? null,
      }))
      await Reconciliation.updateOne({ _id: recon._id }, { $set: { preTickedIds: ids, preTickedRows: snapshot } }, { strict: false })
    }

    const summary = await liveSummary(recon, account)
    recon.openingBalance = summary.openingBalance
    recon.clearedBalance = summary.clearedBalance
    recon.difference = summary.difference
    await recon.save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'RECONCILIATION',
      entityId: recon._id.toString(),
      changes:  JSON.stringify({
        account: account.name, statementDate: d.statementDate, statementBalance: recon.statementBalance,
        openingBalance: summary.openingBalance, preTicked: pre.length,
      }),
      request,
    })

    return NextResponse.json({ data: { ...shapeRecon(recon.toObject()), summary } }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/reconciliations]')
  }
}
