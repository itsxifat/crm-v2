/**
 * Server-only helpers for the transfer routes (private folder, never routed).
 * A transfer = two Transaction legs (kind TRANSFER) sharing `transferId`:
 * EXPENSE on the source account, INCOME on the destination; an optional fee
 * row (kind OPERATING, category 'Bank Charges') shares the same transferId.
 */

import mongoose from 'mongoose'
import { MoneyAccount, Transaction, User } from '@/models'
import { accountAmountOf } from '@/lib/finance/ledger'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function accountRef(a) {
  if (!a) return null
  return {
    id:          String(a._id),
    name:        a.name,
    type:        a.type,
    currency:    a.currency || 'BDT',
    last4:       a.last4 ?? null,
    bankName:    a.bankName ?? null,
    mfsProvider: a.mfsProvider ?? null,
    color:       a.color ?? null,
    status:      a.status,
  }
}

/**
 * Transfers matching `match` (a Transaction filter; kind TRANSFER is added),
 * newest first. Returns { rows, total }.
 */
export async function findTransfers(match = {}, { skip = 0, limit = 20 } = {}) {
  const pipeline = [
    { $match: { transferId: { $ne: null }, ...match, kind: 'TRANSFER' } },
    { $group: {
      _id: '$transferId',
      date: { $min: '$date' },
      createdAt: { $min: '$createdAt' },
      legs: { $push: {
        _id: '$_id', type: '$type', accountId: '$accountId', counterAccountId: '$counterAccountId',
        amount: '$amount', currency: '$currency', amountBDT: '$amountBDT', accountAmount: '$accountAmount',
        channel: '$channel', reference: '$reference', description: '$description', cheque: '$cheque',
        clearStatus: '$clearStatus', txnId: '$txnId', createdBy: '$createdBy', reversalOf: '$reversalOf',
      } },
    } },
    { $sort: { date: -1, createdAt: -1, _id: -1 } },
    { $facet: {
      rows:  [{ $skip: skip }, { $limit: limit }],
      total: [{ $count: 'n' }],
    } },
  ]
  const [res] = await Transaction.aggregate(pipeline)
  const groups = res?.rows ?? []
  const total = res?.total?.[0]?.n ?? 0
  if (!groups.length) return { rows: [], total }

  const transferIds = groups.map(g => g._id)
  const legIds = groups.flatMap(g => g.legs.map(l => l._id))
  const accountIds = new Set()
  const userIds = new Set()
  for (const g of groups) {
    for (const l of g.legs) {
      if (l.accountId) accountIds.add(String(l.accountId))
      if (l.createdBy) userIds.add(String(l.createdBy))
    }
  }

  const [accounts, feeRows, reversals, users] = await Promise.all([
    MoneyAccount.find({ _id: { $in: [...accountIds] } })
      .select('name type currency last4 bankName mfsProvider color status').lean(),
    Transaction.find({ transferId: { $in: transferIds }, kind: { $ne: 'TRANSFER' } })
      .select('transferId type amount accountAmount currency amountBDT reversalOf txnId').lean(),
    Transaction.find({ reversalOf: { $in: legIds }, kind: 'TRANSFER' }).select('reversalOf transferId').lean(),
    userIds.size ? User.find({ _id: { $in: [...userIds] } }).select('name').lean() : [],
  ])
  const accById = new Map(accounts.map(a => [String(a._id), a]))
  const userById = new Map(users.map(u => [String(u._id), u.name]))
  const reversedBy = new Map(reversals.map(r => [String(r.reversalOf), r.transferId]))
  const feesByTransfer = new Map()
  for (const f of feeRows) {
    const list = feesByTransfer.get(f.transferId) ?? []
    list.push(f)
    feesByTransfer.set(f.transferId, list)
  }

  const rows = groups.map(g => {
    const out = g.legs.find(l => l.type === 'EXPENSE') ?? null
    const inn = g.legs.find(l => l.type === 'INCOME') ?? null
    const from = out ? accById.get(String(out.accountId)) : null
    const to   = inn ? accById.get(String(inn.accountId)) : null
    const fees = feesByTransfer.get(g._id) ?? []
    const fee = round2(fees.reduce((s, f) => s + (f.type === 'EXPENSE' ? 1 : -1) * accountAmountOf(f, from), 0))
    const reversalOf = out?.reversalOf || inn?.reversalOf
    const reversedByTransferId = (out && reversedBy.get(String(out._id))) || (inn && reversedBy.get(String(inn._id))) || null
    const cheque = out?.cheque && (out.cheque.no || out.cheque.bank || out.cheque.date) ? out.cheque : null
    return {
      transferId:  g._id,
      date:        g.date,
      createdAt:   g.createdAt,
      from:        accountRef(from),
      to:          accountRef(to),
      amount:      out ? round2(accountAmountOf(out, from)) : null,
      currency:    from?.currency || out?.currency || 'BDT',
      toAmount:    inn ? round2(accountAmountOf(inn, to)) : null,
      toCurrency:  to?.currency || inn?.currency || 'BDT',
      amountBDT:   numOrNull(out?.amountBDT ?? inn?.amountBDT),
      fee,
      channel:     out?.channel ?? inn?.channel ?? null,
      reference:   out?.reference ?? inn?.reference ?? null,
      description: out?.description ?? inn?.description ?? null,
      cheque,
      legs: {
        out: out ? { id: String(out._id), txnId: out.txnId ?? null, clearStatus: out.clearStatus || 'UNCLEARED' } : null,
        in:  inn ? { id: String(inn._id), txnId: inn.txnId ?? null, clearStatus: inn.clearStatus || 'UNCLEARED' } : null,
      },
      feeTxnIds:   fees.map(f => f.txnId).filter(Boolean),
      isReversal:  !!reversalOf,
      reversedByTransferId,
      complete:    !!(out && inn),
      createdBy:   out?.createdBy ? (userById.get(String(out.createdBy)) ?? null) : null,
    }
  })
  return { rows, total }
}

/** One transfer by id, or null. */
export async function findTransfer(transferId) {
  const { rows } = await findTransfers({ transferId: String(transferId) }, { skip: 0, limit: 1 })
  return rows[0] ?? null
}

/** Account filter for transfer listings: either leg touches the account. */
export function accountMatch(accountId) {
  const id = new mongoose.Types.ObjectId(String(accountId))
  return { $or: [{ accountId: id }, { counterAccountId: id }] }
}
