export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { logActivity } from '@/lib/logActivity'
import { maskList, TAX_ENTRY_PII } from '@/lib/pii'
import { round2 } from '@/lib/tax/catalog'
import {
  errorResponse, serializeEntry, tdsDueInfo, vdsDepositDueInfo, todayKey, moneySum, num, depositPaidOf, depositBalanceOf,
} from '../entries/_lib/common'
import { recordChallanDeposit, DEPOSIT_KIND_META } from '../entries/_lib/deposits'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'
import { z } from 'zod'

const HISTORY_FILTERS = {
  TDS:     { entryType: 'TDS_DEPOSIT' },
  VDS:     { entryType: 'VAT_PAYMENT', 'settledEntryIds.0': { $exists: true } },
  VAT:     { entryType: 'VAT_PAYMENT', 'settledEntryIds.0': { $exists: false } },
  ADVANCE: { entryType: 'ADVANCE_TAX' },
  ALL:     { entryType: { $in: ['TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX'] } },
}

const HISTORY_POPULATE = [
  { path: 'createdBy', select: 'name' },
  { path: 'voidedBy', select: 'name' },
  { path: 'filingId', select: 'kind periodKey status' },
  { path: 'transactionId', select: 'txnId amount accountId', populate: { path: 'accountId', select: 'name type last4' } },
]

// GET /api/tax/deposits
//   ?view=payables&kind=TDS|VDS   deductions waiting for a challan (with due dates)
//   ?view=history&kind=TDS|VDS|VAT|ADVANCE|ALL&status=ACTIVE|VOID|all&page&limit   recorded challans
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const view = (searchParams.get('view') || 'payables').toLowerCase()
    const kind = (searchParams.get('kind') || (view === 'history' ? 'ALL' : 'TDS')).toUpperCase()
    await connectDB()

    if (view === 'payables') {
      if (!['TDS', 'VDS'].includes(kind)) return NextResponse.json({ error: 'kind must be TDS or VDS' }, { status: 400 })
      const today = todayKey()
      const rows = await TaxEntry.find({
        status: 'ACTIVE',
        entryType: DEPOSIT_KIND_META[kind].payableType,
        'deposit.status': 'PENDING',
      }).sort({ date: 1, entryNo: 1 }).limit(2000).lean()

      const data = rows.map(r => {
        const out = serializeEntry(r)
        out.due = kind === 'TDS' ? tdsDueInfo(r, today) : vdsDepositDueInfo(r, today)
        // Part payments: what a challan already paid and what is still owed.
        out.paidAmount = depositPaidOf(r)
        out.balance = depositBalanceOf(r)
        return out
      })
      const overdue = data.filter(r => r.due?.overdue)
      const dueSoon = data.filter(r => !r.due?.overdue && r.due?.daysLeft !== null && r.due.daysLeft <= 7)
      const byPayeeType = {}
      for (const r of data) {
        const k = r.payeeType || 'UNKNOWN'
        byPayeeType[k] = round2((byPayeeType[k] ?? 0) + num(r.balance))
      }
      return NextResponse.json({
        data: maskList(session, data, TAX_ENTRY_PII),
        summary: {
          count: data.length,
          amount: moneySum(data, 'balance'),
          partPaid: { count: data.filter(r => r.paidAmount > 0).length, amount: moneySum(data, 'paidAmount') },
          overdue: { count: overdue.length, amount: moneySum(overdue, 'balance'), oldestDue: overdue[0]?.due?.dueDate ?? null },
          dueSoon: { count: dueSoon.length, amount: moneySum(dueSoon, 'balance') },
          byPayeeType,
        },
      })
    }

    if (view !== 'history') return NextResponse.json({ error: 'view must be payables or history' }, { status: 400 })
    const base = HISTORY_FILTERS[kind]
    if (!base) return NextResponse.json({ error: 'kind must be TDS, VDS, VAT, ADVANCE or ALL' }, { status: 400 })
    const filter = { ...base }
    const status = (searchParams.get('status') || 'ACTIVE').toUpperCase()
    if (status !== 'ALL') {
      if (!['ACTIVE', 'VOID'].includes(status)) return NextResponse.json({ error: 'status must be ACTIVE, VOID or all' }, { status: 400 })
      filter.status = status
    }
    const fy = searchParams.get('fiscalYear')
    if (fy) {
      if (!/^\d{4}(-\d{2})?$/.test(fy)) return NextResponse.json({ error: 'fiscalYear must look like 2026-27' }, { status: 400 })
      filter.fiscalYear = fy
    }
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))

    const [rows, total] = await Promise.all([
      TaxEntry.find(filter).sort({ date: -1, entryNo: -1 }).skip((page - 1) * limit).limit(limit).populate(HISTORY_POPULATE).lean(),
      TaxEntry.countDocuments(filter),
    ])
    const data = rows.map(r => ({ ...serializeEntry(r), settledCount: (r.settledEntryIds ?? []).length }))
    return NextResponse.json({
      data: maskList(session, data, TAX_ENTRY_PII),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/tax/deposits]')
  }
}

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable()).optional()
const period = z.preprocess(v => (empty(v) ? null : v), z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM').nullable()).optional()

const schema = z.object({
  kind:           z.enum(['TDS', 'VDS', 'VAT']),
  entryIds:       z.array(z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')).max(500).optional(),
  returnStart:    period,
  returnEnd:      period,
  challanNo:      z.string().trim().min(1, 'Enter the challan number').max(60),
  date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  accountId:      z.preprocess(v => (empty(v) ? null : v), z.string().regex(/^[a-f\d]{24}$/i, 'Invalid account').nullable()).optional(),
  amount:         z.coerce.number().finite().gt(0, 'Enter the amount deposited').max(1e12),
  interestAmount: z.preprocess(v => (empty(v) ? 0 : v), z.coerce.number().finite().min(0).max(1e12)).optional(),
  bank:           optText(120),
  branch:         optText(120),
  accountCode:    optText(60),
  notes:          optText(1000),
  allowPartial:   z.boolean().optional(),
  attachments:    z.array(z.string().trim().max(500).regex(UPLOAD_URL_RE, 'Attach an uploaded file')).max(10).optional(),
}).superRefine((d, ctx) => {
  if (d.kind !== 'VAT' && !(d.entryIds?.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entryIds'], message: 'Select the deductions this challan pays' })
  }
})

// POST /api/tax/deposits — record a treasury challan (tax.deposits.manage)
//   { kind:'TDS'|'VDS', entryIds:[...], challanNo, date, accountId, amount, interestAmount?, bank, branch, accountCode, notes, allowPartial? }
//   { kind:'VAT', returnStart?, returnEnd?, challanNo, date, accountId, amount, interestAmount?, ... }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.deposits.manage')
    if (denied) return denied

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    await connectDB()
    const result = await recordChallanDeposit(parsed.data, { userId: session.user.id })

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'DEPOSIT',
      entity: 'TAX_ENTRY',
      entityId: String(result.deposit._id),
      changes: JSON.stringify({
        kind: parsed.data.kind,
        entryNo: result.deposit.entryNo,
        challanNo: parsed.data.challanNo,
        date: parsed.data.date,
        amount: round2(parsed.data.amount),
        interestAmount: round2(parsed.data.interestAmount ?? 0),
        settled: result.settledIds.length,
        partPaid: result.partPaid,
        unallocatedAmount: result.unallocatedAmount,
        returnPeriod: result.returnPeriod?.key ?? null,
        accountId: parsed.data.accountId ?? null,
        transactionId: String(result.transaction._id),
      }),
      request,
    })

    return NextResponse.json({
      data: {
        deposit: serializeEntry(result.deposit),
        transactionId: String(result.transaction._id),
        txnId: result.transaction.txnId ?? null,
        interestTransactionId: result.interestTransaction ? String(result.interestTransaction._id) : null,
        settledIds: result.settledIds,
        partPaid: result.partPaid ?? [],
        unallocatedAmount: result.unallocatedAmount,
        filing: result.filing,
        returnPeriod: result.returnPeriod,
      },
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/tax/deposits]')
  }
}
