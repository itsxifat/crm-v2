export const dynamic = 'force-dynamic'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import mongoose from 'mongoose'
import { z } from 'zod'
import { MoneyAccount, Transaction } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay, dhakaDayKey } from '@/lib/dhakaTime'
import { postMoneyEntry, accountAmountOf, PAYMENT_CHANNEL_VALUES } from '@/lib/finance/ledger'
import { recordTaxEntry, voidTaxEntry } from '@/lib/tax/engine'
import {
  MOVEMENT_KIND_VALUES, MOVEMENT_KIND_MAP, BANK_CHARGE_TYPES, BANK_CHARGE_LABELS,
  INTEREST_EXPENSE_CATEGORY, BANK_INTEREST_TDS_SECTION,
} from '@/components/finance/movementKinds'
import { errorResponse, optMoney, reqMoney, round2 } from '../accounts/[id]/_lib/accountData'
import {
  MOVEMENT_FILTER, kindFilter, isMovementKind, movementKindOf, linkedRowIds, reverseProblem,
} from './_lib/movements'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'
import { getConfig } from '@/lib/getConfig'
import { COMPANY_UNIT, isValidUnit } from '@/lib/units'

// Reconcilers see the accounts, statements and reconciliations — and these read-only lists on the same pages.
const VIEW_PERMS = ['finance.accounts.view', 'finance.accounts.manage', 'finance.accounts.reconcile']
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
// Movements that belong to a business unit (lib/units.js) chosen on the form;
// every other movement (capital, drawings, loans, loan interest, adjustments) is Company / shared.
const UNIT_KINDS = ['OTHER_INCOME', 'INTEREST_INCOME', 'BANK_CHARGE']

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)
const optStr = (max) => z.preprocess(emptyToNull, z.string().trim().max(max, `Max ${max} characters`).nullable().optional())

const movementSchema = z.object({
  kind:        z.enum(MOVEMENT_KIND_VALUES, { errorMap: () => ({ message: 'Choose what kind of movement this is' }) }),
  accountId:   z.string({ required_error: 'Choose the account' }).refine(isValidObjectId, 'Choose the account'),
  amount:      reqMoney(n => n > 0, 'Amount must be greater than zero'),
  amountBDT:   optMoney(n => n > 0, 'BDT value must be greater than zero'),
  date:        z.string({ required_error: 'Date is required' }).regex(DAY_RE, 'Use a valid date'),
  description: optStr(300),
  reference:   optStr(120),
  channel:     z.preprocess(emptyToNull, z.enum(PAYMENT_CHANNEL_VALUES).nullable().optional()),
  chargeType:  z.preprocess(emptyToNull, z.enum(BANK_CHARGE_TYPES.map(t => t.value)).nullable().optional()),
  category:    optStr(80),
  subcategory: optStr(80),
  party:       optStr(120),
  aitDeducted: optMoney(n => n >= 0, 'Cannot be negative'),
  aitCertificateNo: optStr(60),
  interestAmount:   optMoney(n => n >= 0, 'Cannot be negative'),
  unit:        optStr(60),
  receiptUrl:  z.preprocess(emptyToNull, z.string().trim().max(500, 'Max 500 characters')
    .regex(UPLOAD_URL_RE, 'Attach the receipt with the upload button').nullable().optional()),
  cheque: z.object({
    no:   optStr(40),
    date: z.preprocess(emptyToNull, z.string().regex(DAY_RE, 'Use a valid date').nullable().optional()),
    bank: optStr(120),
  }).nullable().optional(),
})

function fail(field, message, status = 422) {
  return NextResponse.json({ error: message, details: { formErrors: [], fieldErrors: { [field]: [message] } } }, { status })
}

// GET /api/finance/movements?accountId=&kind=&startDate=&endDate=&page=1&limit=20
// Ledger rows created by money movements (capital, drawings, loans, bank charges, interest,
// other income, adjustments) and their reversals. Each row says whether it can be reversed
// (POST /api/finance/movements/[id]) and which rows of the same movement go with it.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const kind      = searchParams.get('kind')
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    if (accountId && !isValidObjectId(accountId)) return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
    if (kind && !isMovementKind(kind)) return NextResponse.json({ error: 'Unknown movement kind' }, { status: 400 })
    if (startDate && !parseDhakaDay(startDate)) return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 422 })
    if (endDate && !parseDhakaDay(endDate)) return NextResponse.json({ error: 'endDate must be YYYY-MM-DD' }, { status: 422 })

    await connectDB()

    const and = [
      { accountId: accountId ? new mongoose.Types.ObjectId(accountId) : { $ne: null } },
      { transferId: null },
      kind ? kindFilter(kind) : MOVEMENT_FILTER,
    ]
    if (startDate || endDate) {
      const date = {}
      if (startDate) date.$gte = parseDhakaDay(startDate).start
      if (endDate) date.$lt = parseDhakaDay(endDate).next
      and.push({ date })
    }
    const filter = { $and: and }

    const [docs, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('accountId', 'name type currency last4 bankName mfsProvider color')
        .populate('createdBy', 'name')
        .lean(),
      Transaction.countDocuments(filter),
    ])

    // Reversal state, the other rows of each movement, and older rows that belong to another record.
    const movementIds = [...new Set(docs.map(d => d.movementId).filter(Boolean))]
    const [reversals, siblings, linked] = await Promise.all([
      docs.length ? Transaction.find({ reversalOf: { $in: docs.map(d => d._id) } }).select('reversalOf txnId date').lean() : [],
      movementIds.length ? Transaction.find({ movementId: { $in: movementIds } }).select('movementId txnId category accountAmount amount currency').lean() : [],
      linkedRowIds(docs),
    ])
    const reversedBy = new Map(reversals.map(r => [String(r.reversalOf), r]))

    const data = docs.map(tx => {
      const acc = tx.accountId && typeof tx.accountId === 'object' ? tx.accountId : null
      const rev = reversedBy.get(String(tx._id)) ?? null
      const related = tx.movementId
        ? siblings.filter(s => s.movementId === tx.movementId && String(s._id) !== String(tx._id))
          .map(s => ({ id: String(s._id), txnId: s.txnId ?? null, category: s.category, accountAmount: round2(accountAmountOf(s, acc)) }))
        : []
      return {
        id:              String(tx._id),
        txnId:           tx.txnId ?? null,
        date:            tx.date,
        type:            tx.type,
        kind:            tx.kind || 'OPERATING',
        movementKind:    movementKindOf(tx),
        movementId:      tx.movementId ?? null,
        isReversal:      !!tx.reversalOf,
        reversedBy:      rev ? { id: String(rev._id), txnId: rev.txnId ?? null, date: rev.date } : null,
        reversible:      !rev && !reverseProblem(tx, linked),
        related,
        category:        tx.category,
        expenseCategory: tx.expenseCategory ?? null,
        description:     tx.description,
        reference:       tx.reference ?? null,
        party:           tx.paidToName ?? null,
        currency:        tx.currency || 'BDT',
        amount:          Number(tx.amount) || 0,
        amountBDT:       tx.amountBDT ?? null,
        accountAmount:   round2(accountAmountOf(tx, acc)),
        plAmountBDT:     tx.plAmountBDT ?? null,
        tax:             tx.tax ?? null,
        clearStatus:     tx.clearStatus || 'UNCLEARED',
        reversalOf:      tx.reversalOf ? String(tx.reversalOf) : null,
        account:         acc ? { id: String(acc._id), name: acc.name, type: acc.type, currency: acc.currency || 'BDT', last4: acc.last4 ?? null, bankName: acc.bankName ?? null, mfsProvider: acc.mfsProvider ?? null, color: acc.color ?? null } : null,
        createdBy:       tx.createdBy && typeof tx.createdBy === 'object' ? (tx.createdBy.name ?? null) : null,
        createdAt:       tx.createdAt,
      }
    })

    return NextResponse.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/movements]')
  }
}

// POST /api/finance/movements — record a non-trading money movement on one account.
// Body: { kind, accountId, amount (account currency), amountBDT? (non-BDT accounts), date, description,
//         reference, channel?, chargeType? (BANK_CHARGE), category?/subcategory? (OTHER_INCOME), party?,
//         aitDeducted? + aitCertificateNo? (INTEREST_INCOME), interestAmount? (LOAN_REPAYMENT), cheque?, receiptUrl?,
//         unit (OTHER_INCOME / INTEREST_INCOME / BANK_CHARGE: venture, product or COMPANY — required) }
// → 201 { data: { transactions: [...], taxEntry } }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.manage')
    if (denied) return denied

    const raw = await request.json().catch(() => null)
    if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = movementSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data
    const def = MOVEMENT_KIND_MAP[d.kind]

    if (!parseDhakaDay(d.date) || d.date > dhakaDayKey(new Date())) return fail('date', 'The date cannot be in the future')
    if (def.txKind === 'ADJUSTMENT' && (!d.description || d.description.length < 5)) {
      return fail('description', 'Explain why the balance is being adjusted (at least 5 characters)')
    }

    await connectDB()
    // Business unit: chosen for other income, interest received and bank charges; else Company / shared.
    let unit = COMPANY_UNIT
    if (UNIT_KINDS.includes(d.kind)) {
      if (!d.unit) return fail('unit', 'Choose the venture or product (or Company / shared)')
      if (!isValidUnit(d.unit, await getConfig())) return fail('unit', 'Unknown venture or product — choose one from the list')
      unit = d.unit
    }

    const account = await MoneyAccount.findById(d.accountId).lean()
    if (!account) return fail('accountId', 'Money account not found')
    if (account.status !== 'ACTIVE') return fail('accountId', `${account.name} is archived — choose an active account`, 409)

    const currency = account.currency || 'BDT'
    const amount = round2(d.amount)
    const amountBDT = currency === 'BDT' ? amount : (d.amountBDT != null ? round2(d.amountBDT) : null)
    if (amountBDT === null) return fail('amountBDT', `Enter the BDT value of this ${currency} amount`)
    const rate = amountBDT / amount
    const toBDT = (v) => (currency === 'BDT' ? round2(v) : round2(v * rate))

    // Every row of this movement is marked with its preset and one shared movementId,
    // so it lists under its kind (custom other-income categories included) and a
    // loan instalment's principal and interest rows are reversed together.
    const movementId = randomUUID()
    const base = {
      movementKind: d.kind,
      movementId,
      unit,
      currency,
      date:        d.date,
      accountId:   account._id,
      reference:   d.reference ?? null,
      channel:     d.channel ?? null,
      cheque:      d.cheque ?? null,
      receiptUrl:  d.receiptUrl ?? null,
      paidToName:  d.party ?? null,
    }
    const description = d.description ?? null
    const entries = []

    if (d.kind === 'LOAN_REPAYMENT') {
      const interest = round2(d.interestAmount ?? 0)
      if (interest > amount + 0.005) return fail('interestAmount', 'Interest cannot be more than the amount paid')
      const principal = round2(amount - interest)
      const interestBDT = toBDT(interest)
      if (principal > 0.005) {
        entries.push({
          ...base, type: 'EXPENSE', kind: 'LOAN', category: def.category,
          amount: principal, amountBDT: round2(amountBDT - interestBDT),
          description: description ?? `Loan repayment${d.party ? ` — ${d.party}` : ''}`,
        })
      }
      if (interest > 0.005) {
        entries.push({
          ...base, type: 'EXPENSE', kind: 'OPERATING', category: INTEREST_EXPENSE_CATEGORY,
          expenseCategory: 'Loan interest',
          amount: interest, amountBDT: interestBDT, plAmountBDT: interestBDT,
          description: `Loan interest${d.party ? ` — ${d.party}` : ''}${description ? ` (${description})` : ''}`,
        })
      }
    } else if (d.kind === 'INTEREST_INCOME') {
      const ait = round2(d.aitDeducted ?? 0)
      const aitBDT = toBDT(ait)
      const grossBDT = round2(amountBDT + aitBDT)
      entries.push({
        ...base, type: 'INCOME', kind: 'OPERATING', category: def.category,
        expenseCategory: d.subcategory ?? null,
        amount, amountBDT, plAmountBDT: grossBDT,
        description: description ?? `Interest from ${account.bankName || account.name}`,
        ...(ait > 0 ? { tax: { grossBDT, tdsBDT: aitBDT, taxDeductible: true } } : {}),
      })
    } else if (d.kind === 'BANK_CHARGE') {
      const chargeLabel = d.chargeType ? BANK_CHARGE_LABELS[d.chargeType] : null
      entries.push({
        ...base, type: 'EXPENSE', kind: 'OPERATING', category: def.category,
        expenseCategory: chargeLabel,
        amount, amountBDT, plAmountBDT: amountBDT,
        description: description ?? `${chargeLabel ?? 'Bank charge'} — ${account.name}`,
      })
    } else if (d.kind === 'OTHER_INCOME') {
      entries.push({
        ...base, type: 'INCOME', kind: 'OPERATING', category: d.category ?? def.category,
        expenseCategory: d.subcategory ?? null,
        amount, amountBDT, plAmountBDT: amountBDT,
        description: description ?? (d.category ?? def.category),
      })
    } else {
      entries.push({
        ...base,
        type: def.direction === 'IN' ? 'INCOME' : 'EXPENSE',
        kind: def.txKind,
        category: def.category,
        amount, amountBDT,
        description: description ?? `${def.label}${d.party ? ` — ${d.party}` : ''}`,
      })
    }

    // Post sequentially; undo earlier rows if a later one (or the tax entry) fails.
    const posted = []
    let taxEntry = null
    try {
      for (const e of entries) posted.push(await postMoneyEntry(e, { userId: session.user.id }))

      if (d.kind === 'INTEREST_INCOME' && (d.aitDeducted ?? 0) > 0) {
        const tx = posted[0]
        const ait = round2(d.aitDeducted)
        const aitBDT = toBDT(ait)
        const grossBDT = round2(amountBDT + aitBDT)
        taxEntry = await recordTaxEntry({
          entryType:    'TDS_RECEIVABLE',
          date:         d.date,
          baseAmount:   grossBDT,
          rate:         grossBDT > 0 ? round2((aitBDT / grossBDT) * 100) : null,
          amount:       aitBDT,
          section:      BANK_INTEREST_TDS_SECTION,
          payeeType:    'COMPANY',
          partyType:    'OTHER',
          partyName:    account.bankName || account.name,
          documentNo:   d.reference ?? tx.txnId ?? null,
          documentDate: d.date,
          certificate:  d.aitCertificateNo
            ? { status: 'RECEIVED', number: d.aitCertificateNo, date: d.date }
            : { status: 'PENDING' },
          bankingChannel: true,
          transactionId: tx._id,
          notes:        `Tax deducted at source by ${account.bankName || account.name} on interest (${account.name}${account.last4 ? ` ••${account.last4}` : ''})`,
        }, { userId: session.user.id })
        await Transaction.updateOne({ _id: tx._id }, { $set: { taxEntryIds: [taxEntry._id] } })
        tx.taxEntryIds = [taxEntry._id]
      }
    } catch (err) {
      if (taxEntry) {
        // The AIT credit must not outlive the interest row it belongs to.
        await voidTaxEntry(taxEntry._id, { reason: 'Interest entry could not be saved', userId: session.user.id, allowLocked: true })
          .catch(e => console.error('[movements] compensating tax-entry void failed', String(taxEntry._id), e))
      }
      if (posted.length) {
        await Transaction.deleteMany({ _id: { $in: posted.map(t => t._id) } })
          .catch(e => console.error('[movements] compensating delete failed', e))
      }
      throw err
    }

    for (const tx of posted) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'CREATE',
        entity:   'TRANSACTION',
        entityId: tx._id.toString(),
        changes:  JSON.stringify({
          movement: d.kind, movementId, txnId: tx.txnId, account: account.name, type: tx.type, kind: tx.kind, unit,
          category: tx.category, amount: tx.amount, currency: tx.currency, amountBDT: tx.amountBDT,
          date: d.date, aitDeducted: d.kind === 'INTEREST_INCOME' ? (d.aitDeducted ?? 0) : undefined,
          taxEntryNo: taxEntry?.entryNo,
        }),
        request,
      })
    }

    return NextResponse.json({
      data: {
        transactions: posted.map(t => t.toJSON()),
        taxEntry: taxEntry ? taxEntry.toJSON() : null,
      },
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/movements]')
  }
}
