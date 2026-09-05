export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Project, Client, User, CombinedInvoice } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import { logActivity } from '@/lib/logActivity'
import { canAccess } from '@/lib/permissions'
import { requirePerm } from '@/lib/rbac'
import { ciContains } from '@/lib/searchMatch'
import { ensureCombinedInvoice, toObjectId } from '@/lib/combinedInvoice'

// Mixed-typed money fields can hold legacy non-numeric values; coerce defensively
// so $sort / $group never blow up on one bad document.
const num = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })

// Whitelisted sort keys → the expression they sort on.
const SORT_FIELDS = {
  invoiceNumber: 'invoiceNumber',
  issueDate:     'issueDate',
  dueDate:       'dueDate',
  status:        'status',
  createdAt:     'createdAt',
  total:         '_total',
  paidAmount:    '_paid',
  due:           '_due',
}

/**
 * Resolve free-text search into an extra $match clause.
 * Searches the invoice number directly plus project (name/code) and client
 * (company/code/contact name) by resolving those to id sets first.
 */
async function buildSearchClause(search) {
  const rx = ciContains(search)

  const [projects, clients, users] = await Promise.all([
    Project.find({ $or: [{ name: rx }, { projectCode: rx }] }).select('_id').lean(),
    Client.find({ $or: [{ company: rx }, { clientCode: rx }, { contactPerson: rx }] }).select('_id').lean(),
    User.find({ name: rx }).select('_id').lean(),
  ])

  const clientIds = new Set(clients.map(c => c._id.toString()))
  if (users.length > 0) {
    const viaUser = await Client.find({ userId: { $in: users.map(u => u._id) } }).select('_id').lean()
    viaUser.forEach(c => clientIds.add(c._id.toString()))
  }

  const projectIds = projects.map(p => p._id)
  const clientOids = [...clientIds].map(toObjectId)

  const or = [{ invoiceNumber: rx }]
  if (projectIds.length) or.push({ projectId: { $in: projectIds } }, { projectIds: { $in: projectIds } })
  if (clientOids.length) or.push({ clientId: { $in: clientOids } })
  return { $or: or }
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    // Block FREELANCER/VENDOR (invoices: none); CLIENT (ro) is scoped to own below.
    if (!canAccess(session, 'invoices', 'read'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit     = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const status    = searchParams.get('status')
    const clientId  = searchParams.get('clientId')
    const projectId = searchParams.get('projectId')
    const venture   = searchParams.get('venture')
    const search    = searchParams.get('search')?.trim()
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const dateField = searchParams.get('dateField') === 'dueDate' ? 'dueDate' : 'issueDate'
    const groupBy   = searchParams.get('groupBy')
    const sortKey   = SORT_FIELDS[searchParams.get('sort')] ? searchParams.get('sort') : 'createdAt'
    const sortDir   = searchParams.get('dir') === 'asc' ? 1 : -1
    const skip      = (page - 1) * limit

    const and = []
    if (status)   and.push({ status })
    if (clientId) and.push({ clientId: toObjectId(clientId) })

    // Match both new (projectId) and legacy (projectIds array) styles
    if (projectId) {
      const oid = toObjectId(projectId)
      and.push({ $or: [{ projectId: oid }, { projectIds: oid }] })
    }

    // Venture lives on the project, so resolve it to a project id set first.
    if (venture) {
      const vp = await Project.find({ venture }).select('_id').lean()
      const ids = vp.map(p => p._id)
      and.push(ids.length ? { $or: [{ projectId: { $in: ids } }, { projectIds: { $in: ids } }] } : { _id: null })
    }

    if (startDate || endDate) {
      const range = {}
      if (startDate) range.$gte = new Date(startDate)
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        range.$lte = end
      }
      and.push({ [dateField]: range })
    }

    if (search) and.push(await buildSearchClause(search))

    // CLIENT role: only the active company's issued invoices
    if (session.user.role === 'CLIENT') {
      const { clientId: activeId } = await resolveActiveClient(session)
      and.push({ clientId: activeId ?? null })
      and.push({ status: { $ne: 'DRAFT' } })
    }

    const match = and.length ? { $and: and } : {}

    // Derived money fields, shared by the list, the grouping and the stats.
    const withMoney = {
      $addFields: {
        _total: num('total'),
        _paid:  { $min: [num('paidAmount'), num('total')] },
      },
    }
    const withDue = {
      $addFields: { _due: { $max: [0, { $subtract: ['$_total', '$_paid'] }] } },
    }

    // ── Project-wise grouping ────────────────────────────────────────────────
    if (groupBy === 'project') {
      const grouped = await Invoice.aggregate([
        { $match: match },
        withMoney, withDue,
        {
          $group: {
            _id: { $ifNull: ['$projectId', { $arrayElemAt: ['$projectIds', 0] }] },
            clientId: { $first: '$clientId' },
            count:    { $sum: 1 },
            total:    { $sum: '$_total' },
            paid:     { $sum: '$_paid' },
            due:      { $sum: '$_due' },
            draftCount:   { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
            overdueCount: { $sum: { $cond: [{ $eq: ['$status', 'OVERDUE'] }, 1, 0] } },
            paidCount:    { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
            lastIssued:   { $max: '$issueDate' },
            nextDue:      { $min: { $cond: [{ $gt: ['$_due', 0] }, '$dueDate', null] } },
          },
        },
        { $sort: { due: -1, total: -1 } },
        {
          $facet: {
            rows:  [{ $skip: skip }, { $limit: limit }],
            count: [{ $count: 'n' }],
          },
        },
      ])

      const rows  = grouped[0]?.rows ?? []
      const total = grouped[0]?.count?.[0]?.n ?? 0

      const projectIds = rows.map(r => r._id).filter(Boolean)
      const [projects, combined] = await Promise.all([
        Project.find({ _id: { $in: projectIds } }).select('name projectCode venture category budget discount').lean(),
        CombinedInvoice.find({ projectId: { $in: projectIds } }).select('combinedNumber projectId').lean(),
      ])
      const clients = await Client.find({ _id: { $in: rows.map(r => r.clientId).filter(Boolean) } })
        .select('company clientCode userId')
        .populate('userId', 'name')
        .lean()

      const projectById  = new Map(projects.map(p => [p._id.toString(), p]))
      const combinedById = new Map(combined.map(c => [c.projectId.toString(), c]))
      const clientById   = new Map(clients.map(c => [c._id.toString(), c]))

      return NextResponse.json({
        data: rows.map(r => {
          const key = r._id?.toString()
          const p   = key ? projectById.get(key) : null
          const c   = r.clientId ? clientById.get(r.clientId.toString()) : null
          const cmb = key ? combinedById.get(key) : null
          return {
            projectId: key ?? null,
            project: p
              ? { id: key, name: p.name, projectCode: p.projectCode, venture: p.venture, category: p.category }
              : null,
            client: c
              ? { id: c._id.toString(), company: c.company, clientCode: c.clientCode, name: c.userId?.name ?? null }
              : null,
            combined: cmb ? { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber } : null,
            invoiceCount: r.count,
            draftCount:   r.draftCount,
            overdueCount: r.overdueCount,
            paidCount:    r.paidCount,
            total: Math.round(r.total * 100) / 100,
            paid:  Math.round(r.paid  * 100) / 100,
            due:   Math.round(r.due   * 100) / 100,
            lastIssued: r.lastIssued ?? null,
            nextDue:    r.nextDue    ?? null,
          }
        }),
        meta: { page, limit, total, pages: Math.ceil(total / limit), groupBy: 'project' },
      })
    }

    // ── Flat list ────────────────────────────────────────────────────────────
    const sortSpec = { [SORT_FIELDS[sortKey]]: sortDir, _id: sortDir }   // _id keeps paging stable

    const [rows, countRes, statsRes] = await Promise.all([
      Invoice.aggregate([
        { $match: match },
        withMoney, withDue,
        { $sort: sortSpec },
        { $skip: skip },
        { $limit: limit },
      ]),
      Invoice.countDocuments(match),
      // Stats span the WHOLE filtered set, not just the current page.
      Invoice.aggregate([
        { $match: match },
        withMoney, withDue,
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            total: { $sum: '$_total' },
            paid:  { $sum: '$_paid' },
            due:   { $sum: '$_due' },
          },
        },
      ]),
    ])

    await Invoice.populate(rows, [
      { path: 'clientId', populate: { path: 'userId', select: 'name email avatar' } },
      { path: 'projectId',  select: 'name projectCode venture' },
      { path: 'projectIds', select: 'name projectCode venture' },
      { path: 'createdBy', select: 'name' },
    ])

    // Combined-invoice pointer for every project represented on this page, so
    // the list can link straight to the consolidated document.
    const pageProjectIds = [...new Set(
      rows.map(r => (r.projectId?._id ?? r.projectId ?? r.projectIds?.[0]?._id ?? r.projectIds?.[0])?.toString())
        .filter(Boolean)
    )]
    const combinedDocs = pageProjectIds.length
      ? await CombinedInvoice.find({ projectId: { $in: pageProjectIds.map(toObjectId) } })
          .select('combinedNumber projectId').lean()
      : []
    const combinedByProject = new Map(combinedDocs.map(c => [c.projectId.toString(), c]))

    const byStatus = {}
    let billed = 0, collected = 0, outstanding = 0, overdueAmount = 0
    for (const s of statsRes) {
      byStatus[s._id] = {
        count: s.count,
        total: Math.round(s.total * 100) / 100,
        paid:  Math.round(s.paid  * 100) / 100,
        due:   Math.round(s.due   * 100) / 100,
      }
      if (s._id === 'CANCELLED') continue
      billed    += s.total
      collected += s.paid
      if (s._id !== 'DRAFT') outstanding += s.due
      if (s._id === 'OVERDUE') overdueAmount += s.due
    }

    return NextResponse.json({
      data: rows.map(r => {
        const pid = (r.projectId?._id ?? r.projectId ?? r.projectIds?.[0]?._id ?? r.projectIds?.[0])?.toString()
        const cmb = pid ? combinedByProject.get(pid) : null
        return {
          ...r,
          id:  r._id.toString(),
          _id: undefined,
          due: Math.round(r._due * 100) / 100,
          combined: cmb ? { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber } : null,
        }
      }),
      meta: { page, limit, total: countRes, pages: Math.ceil(countRes / limit), sort: sortKey, dir: sortDir === 1 ? 'asc' : 'desc' },
      stats: {
        invoiceCount: countRes,
        billed:      Math.round(billed * 100) / 100,
        collected:   Math.round(collected * 100) / 100,
        outstanding: Math.round(outstanding * 100) / 100,
        overdue:     Math.round(overdueAmount * 100) / 100,
        collectedPct: billed > 0 ? Math.round((collected / billed) * 100) : 0,
        byStatus,
      },
    })
  } catch (err) {
    console.error('[GET /api/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.create')
    if (denied) return denied
    await connectDB()

    const body = await request.json()
    const { clientId, projectId, items, issueDate, dueDate, taxRate, discount, notes, terms, currency } = body

    if (!clientId) return NextResponse.json({ error: 'Client required' }, { status: 422 })
    if (!items || items.length === 0) return NextResponse.json({ error: 'At least one item required' }, { status: 422 })

    // Recalculate totals server-side
    const processedItems = items.map(item => ({
      description: item.description,
      quantity:    Number(item.quantity) || 1,
      rate:        Number(item.rate)     || 0,
      amount:      (Number(item.quantity) || 1) * (Number(item.rate) || 0),
    }))
    const subtotal  = Math.round(processedItems.reduce((s, i) => s + i.amount, 0) * 100) / 100
    const taxAmt    = Math.round(subtotal * ((Number(taxRate) || 0) / 100) * 100) / 100
    const total     = Math.round((subtotal + taxAmt - (Number(discount) || 0)) * 100) / 100

    const invoice = await new Invoice({
      clientId,
      projectId:   projectId || null,
      items:       processedItems,
      issueDate:   issueDate ? new Date(issueDate) : new Date(),
      dueDate:     dueDate   ? new Date(dueDate)   : null,
      subtotal,
      taxRate:     Number(taxRate)   || 0,
      taxAmount:   taxAmt,
      discount:    Number(discount)  || 0,
      total,
      currency:    currency ?? 'BDT',
      notes:       notes || null,
      terms:       terms || null,
      createdBy:   session.user.id,
    }).save()

    // A project's 2nd invoice earns it a combined invoice automatically.
    let combined = null
    if (projectId) {
      try {
        combined = await ensureCombinedInvoice(projectId, { createdBy: session.user.id })
      } catch (e) {
        console.error('[POST /api/invoices] ensureCombinedInvoice', e)
      }
    }

    await invoice.populate([
      { path: 'clientId',  populate: { path: 'userId', select: 'name email avatar' } },
      { path: 'projectId', select: 'name projectCode venture' },
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'INVOICE',
      entityId: invoice._id.toString(),
      changes:  JSON.stringify({ invoiceNumber: invoice.invoiceNumber, total: invoice.total, currency: invoice.currency }),
      request,
    })

    return NextResponse.json({
      data: invoice.toJSON(),
      combined: combined ? { id: combined._id.toString(), combinedNumber: combined.combinedNumber } : null,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
