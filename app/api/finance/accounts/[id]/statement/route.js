export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { getAccountStatement } from '@/lib/finance/ledger'
import { loadAccount, errorResponse } from '../_lib/accountData'

const VIEW_PERMS = ['finance.accounts.view', 'finance.accounts.manage', 'finance.accounts.reconcile']
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function shapeRow(tx) {
  const counter = tx.counterAccountId && typeof tx.counterAccountId === 'object' && tx.counterAccountId.name
    ? {
        id:       String(tx.counterAccountId._id),
        name:     tx.counterAccountId.name,
        type:     tx.counterAccountId.type,
        currency: tx.counterAccountId.currency || 'BDT',
        last4:    tx.counterAccountId.last4 ?? null,
      }
    : null
  return {
    id:               tx.id,
    txnId:            tx.txnId ?? null,
    date:             tx.date,
    type:             tx.type,
    kind:             tx.kind || 'OPERATING',
    category:         tx.category,
    expenseCategory:  tx.expenseCategory ?? null,
    description:      tx.description,
    reference:        tx.reference ?? null,
    channel:          tx.channel ?? null,
    paymentMethod:    tx.paymentMethod ?? null,
    cheque:           tx.cheque && (tx.cheque.no || tx.cheque.bank || tx.cheque.date) ? tx.cheque : null,
    clearStatus:      tx.clearStatus || 'UNCLEARED',
    clearedDate:      tx.clearedDate ?? null,
    reconciliationId: tx.reconciliationId ? String(tx.reconciliationId) : null,
    transferId:       tx.transferId ?? null,
    reversalOf:       tx.reversalOf ? String(tx.reversalOf) : null,
    counterAccount:   counter,
    invoiceId:        tx.invoiceId ? String(tx.invoiceId) : null,
    projectId:        tx.projectId ? String(tx.projectId) : null,
    paidToName:       tx.paidToName ?? null,
    vendor:           tx.vendor ?? null,
    receiptUrl:       tx.receiptUrl ?? null,
    currency:         tx.currency || 'BDT',
    amount:           numOrNull(tx.amount),
    amountBDT:        numOrNull(tx.amountBDT),
    accountAmount:    numOrNull(tx.accountAmount),
    tax:              tx.tax ?? null,
    hasTaxEntries:    Array.isArray(tx.taxEntryIds) && tx.taxEntryIds.length > 0,
    createdBy:        tx.createdBy && typeof tx.createdBy === 'object' ? (tx.createdBy.name ?? null) : null,
    createdAt:        tx.createdAt ?? null,
    inAmount:         tx.inAmount,
    outAmount:        tx.outAmount,
    running:          tx.running,
    excluded:         !!tx.excluded,
  }
}

// GET /api/finance/accounts/[id]/statement?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&page=1&limit=200
// → { data: { account, openingBalance, closingBalance, totals:{inflow,outflow}, openingDate,
//             preOpeningCount, rows:[{…, inAmount, outAmount, running, excluded}] }, meta }
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || null
    const endDate   = searchParams.get('endDate') || null
    if (startDate && !DAY_RE.test(startDate)) return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 422 })
    if (endDate && !DAY_RE.test(endDate)) return NextResponse.json({ error: 'endDate must be YYYY-MM-DD' }, { status: 422 })
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get('limit') ?? '200', 10) || 200))

    await connectDB()
    const [statement, account] = await Promise.all([
      getAccountStatement(params.id, { startDate, endDate, page, limit }),
      loadAccount(session, params.id),
    ])
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      data: {
        account,
        range:           { startDate, endDate },
        openingDate:     statement.openingDate,
        openingBalance:  statement.openingBalance,
        closingBalance:  statement.closingBalance,
        totals:          statement.totals,
        preOpeningCount: statement.preOpeningCount,
        rows:            statement.rows.map(shapeRow),
      },
      meta: statement.meta,
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/accounts/[id]/statement]')
  }
}
