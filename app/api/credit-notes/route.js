export const dynamic = 'force-dynamic'
import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CreditNote, Invoice } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay, dhakaDayKey } from '@/lib/dhakaTime'
import { CREDIT_NOTE_REASONS } from '@/lib/tax/catalog'
import { z } from 'zod'
import { issueNote, limitsForInvoice, NOTE_REASON_VALUES, NOTE_VIEW_PERMS } from './_lib/creditNotes'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** aggregate() does not cast — id filters must be real ObjectIds. */
function aggregateMatch(filter) {
  const m = { ...filter }
  if (m.invoiceId) m.invoiceId = new mongoose.Types.ObjectId(String(m.invoiceId))
  if (m.clientId) m.clientId = new mongoose.Types.ObjectId(String(m.clientId))
  return m
}

const POPULATE = [
  { path: 'invoiceId', select: 'invoiceNumber status currency total paidAmount vatTreatment issuedAt issueDate' },
  { path: 'clientId', select: 'company clientCode userId', populate: { path: 'userId', select: 'name' } },
  { path: 'createdBy', select: 'name' },
  { path: 'cancelledBy', select: 'name' },
  { path: 'refundAccountId', select: 'name type last4 currency' },
]

function serialize(doc) {
  const o = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc }
  if (o._id) { o.id = String(o._id); delete o._id }
  delete o.__v
  return o
}

// Numbers stay numbers; text that a spreadsheet would run as a formula
// (= + - @ tab CR) is prefixed with ' (client names / reasons are user input).
const csvCell = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /api/credit-notes?invoiceId=&clientId=&kind=&status=&settlement=&search=&startDate=&endDate=&page=&limit=&format=csv
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, NOTE_VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const { searchParams } = new URL(request.url)
    const invoiceId  = searchParams.get('invoiceId')
    const clientId   = searchParams.get('clientId')
    const kind       = searchParams.get('kind')
    const status     = searchParams.get('status')
    const settlement = searchParams.get('settlement')
    const search     = searchParams.get('search')?.trim()
    const startDate  = searchParams.get('startDate')
    const endDate    = searchParams.get('endDate')
    const format     = searchParams.get('format')
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))

    const filter = {}
    if (invoiceId) {
      if (!isValidObjectId(invoiceId)) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })
      filter.invoiceId = invoiceId
    }
    if (clientId) {
      if (!isValidObjectId(clientId)) return NextResponse.json({ error: 'Invalid client id' }, { status: 400 })
      filter.clientId = clientId
    }
    if (kind) {
      if (!['CREDIT', 'DEBIT'].includes(kind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
      filter.kind = kind
    }
    if (status) {
      if (!['ISSUED', 'CANCELLED'].includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      filter.status = status
    }
    if (settlement) {
      if (!['ADJUST_INVOICE', 'REFUND'].includes(settlement)) return NextResponse.json({ error: 'Invalid settlement' }, { status: 400 })
      filter.settlement = settlement
    }
    if (startDate || endDate) {
      const range = {}
      if (startDate) {
        const d = DAY_RE.test(startDate) ? parseDhakaDay(startDate) : null
        if (!d) return NextResponse.json({ error: 'Invalid start date' }, { status: 400 })
        range.$gte = d.start
      }
      if (endDate) {
        const d = DAY_RE.test(endDate) ? parseDhakaDay(endDate) : null
        if (!d) return NextResponse.json({ error: 'Invalid end date' }, { status: 400 })
        range.$lt = d.next
      }
      filter.issuedAt = range
    }
    if (search) {
      const rx = { $regex: escapeRegex(search.slice(0, 100)), $options: 'i' }
      filter.$or = [{ noteNo: rx }, { invoiceNumber: rx }, { 'buyer.name': rx }, { 'buyer.bin': rx }, { reasonText: rx }]
    }

    if (format === 'csv') {
      const rows = await CreditNote.find(filter).sort({ issuedAt: -1, _id: -1 }).limit(10000).populate(POPULATE).lean()
      const reasonLabel = (v) => CREDIT_NOTE_REASONS.find(r => r.value === v)?.label ?? v
      const header = ['Note no', 'Type', 'Issued (Dhaka)', 'Invoice no', 'Client', 'Buyer BIN', 'Reason', 'Details', 'Value (excl. VAT)', 'SD', 'VAT', 'Total', 'Currency', 'Settlement', 'Refund account', 'Status']
      const lines = [header.map(csvCell).join(',')]
      for (const n of rows) {
        lines.push([
          n.noteNo,
          n.kind === 'DEBIT' ? 'Debit note (Mushak-6.8)' : 'Credit note (Mushak-6.7)',
          n.issuedAt ? dhakaDayKey(n.issuedAt) : '',
          n.invoiceNumber ?? n.invoiceId?.invoiceNumber ?? '',
          n.clientId?.company ?? n.clientId?.userId?.name ?? n.buyer?.name ?? '',
          n.buyer?.bin ?? '',
          reasonLabel(n.reason),
          n.reasonText ?? '',
          n.valueAmount, n.sdAmount, n.vatAmount, n.totalAmount,
          n.invoiceId?.currency ?? 'BDT',
          n.kind === 'DEBIT' ? 'Added to invoice' : (n.settlement === 'REFUND' ? 'Refunded' : 'Adjusted against invoice'),
          n.refundAccountId?.name ?? '',
          n.status,
        ].map(csvCell).join(','))
      }
      return new Response('﻿' + lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="credit-debit-notes-${dhakaDayKey()}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const [docs, total, summaryRows] = await Promise.all([
      CreditNote.find(filter).sort({ issuedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate(POPULATE),
      CreditNote.countDocuments(filter),
      CreditNote.aggregate([
        { $match: aggregateMatch(filter) },
        { $lookup: {
          from: Invoice.collection.name,
          let: { iid: '$invoiceId' },
          pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$iid'] } } }, { $project: { currency: 1 } }],
          as: 'inv',
        } },
        { $group: {
          _id: { kind: '$kind', status: '$status', currency: { $ifNull: [{ $arrayElemAt: ['$inv.currency', 0] }, 'BDT'] } },
          count: { $sum: 1 },
          value: { $sum: '$valueAmount' },
          vat:   { $sum: '$vatAmount' },
          sd:    { $sum: '$sdAmount' },
          total: { $sum: '$totalAmount' },
        } },
      ]),
    ])

    const summary = summaryRows.map(r => ({
      kind: r._id.kind,
      status: r._id.status,
      currency: r._id.currency,
      count: r.count,
      value: Math.round(r.value * 100) / 100,
      vat: Math.round(r.vat * 100) / 100,
      sd: Math.round(r.sd * 100) / 100,
      total: Math.round(r.total * 100) / 100,
    }))

    const body = {
      data: docs.map(serialize),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
      summary,
    }
    // On an invoice page: what can still be credited / refunded.
    if (invoiceId) body.context = await limitsForInvoice(invoiceId)

    return NextResponse.json(body)
  } catch (err) {
    console.error('[GET /api/credit-notes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(500),
  quantity:    z.coerce.number().positive('Quantity must be greater than 0').max(1e9).optional().default(1),
  value:       z.coerce.number().positive('Value must be greater than 0').max(1e12),
  vatRate:     z.coerce.number().min(0).max(100).optional().nullable(),
  sdRate:      z.coerce.number().min(0).max(500).optional().nullable(),
})

const createSchema = z.object({
  kind:            z.enum(['CREDIT', 'DEBIT']),
  invoiceId:       z.string().min(1, 'Invoice is required'),
  reason:          z.enum(NOTE_REASON_VALUES),
  reasonText:      z.string().trim().max(1000).optional().nullable(),
  items:           z.array(itemSchema).min(1, 'Add at least one line').max(100),
  settlement:      z.enum(['ADJUST_INVOICE', 'REFUND']).optional().nullable(),
  refundAccountId: z.string().optional().nullable(),
  refundDate:      z.string().regex(DAY_RE, 'Use YYYY-MM-DD').optional().nullable(),
  issuedAt:        z.string().optional().nullable(),
  issueDate:       z.string().regex(DAY_RE, 'Use YYYY-MM-DD').optional().nullable(),
  issueTime:       z.string().regex(/^\d{1,2}:\d{2}$/, 'Use HH:mm').optional().nullable(),
})

// POST /api/credit-notes — issue a credit (Mushak-6.7) or debit (Mushak-6.8) note
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.notes.manage')
    if (denied) return denied

    await connectDB()
    const raw = await request.json().catch(() => null)
    const parsed = createSchema.safeParse(raw ?? {})
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const data = parsed.data
    if (!isValidObjectId(data.invoiceId)) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (data.kind === 'CREDIT' && data.settlement === 'REFUND' && data.refundAccountId && !isValidObjectId(data.refundAccountId))
      return NextResponse.json({ error: 'Validation failed', details: { fieldErrors: { refundAccountId: ['Invalid money account'] } } }, { status: 422 })

    let result
    try {
      result = await issueNote({
        ...data,
        settlement: data.kind === 'DEBIT' ? 'ADJUST_INVOICE' : (data.settlement || 'ADJUST_INVOICE'),
        refundAccountId: data.refundAccountId || null,
      }, { userId: session.user.id })
    } catch (err) {
      if (err.status) return NextResponse.json({ error: err.message, ...(err.details ? { details: err.details } : {}) }, { status: err.status })
      throw err
    }

    const { note, taxEntry, transaction, warnings } = result
    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'ISSUE_NOTE',
      entity:   'CREDIT_NOTE',
      entityId: note._id.toString(),
      changes:  JSON.stringify({
        noteNo: note.noteNo,
        kind: note.kind,
        invoiceNumber: note.invoiceNumber,
        settlement: note.settlement,
        valueAmount: note.valueAmount,
        vatAmount: note.vatAmount,
        sdAmount: note.sdAmount,
        totalAmount: note.totalAmount,
        ...(taxEntry ? { taxEntry: taxEntry.entryNo } : {}),
        ...(transaction ? { transaction: transaction.txnId } : {}),
      }),
      request,
    })

    const fresh = await CreditNote.findById(note._id).populate(POPULATE)
    return NextResponse.json({
      data: serialize(fresh ?? note),
      taxEntry: taxEntry ? { id: taxEntry._id.toString(), entryNo: taxEntry.entryNo, period: taxEntry.period } : null,
      transaction: transaction ? { id: transaction._id.toString(), txnId: transaction.txnId } : null,
      ...(warnings.length ? { warning: warnings.join(' '), warnings } : {}),
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/credit-notes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
