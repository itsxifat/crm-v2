export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Project, Client, User, CombinedInvoice } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import { logActivity } from '@/lib/logActivity'
import { requirePerm, canDo, canDoAny } from '@/lib/rbac'
import { maskDoc, INVOICE_PII } from '@/lib/pii'
import { ciContains, wordMatches, amountQuery, amountEquals } from '@/lib/searchMatch'
import { codeContains } from '@/lib/codes'
import { ensureCombinedInvoice, toObjectId, NON_BILLABLE_STATUSES } from '@/lib/combinedInvoice'
import { computeInvoiceTotals, INVOICE_VAT_TREATMENTS } from '@/lib/invoiceTotals'
import { isValidObjectId } from '@/lib/objectId'
import { getFinanceSettings } from '@/lib/finance/settings'
import { VAT_TREATMENTS, BIN_REGEX } from '@/lib/tax/catalog'
import { BASE_CURRENCY, isValidCurrency } from '@/lib/currencies'
import { parseDhakaDay } from '@/lib/dhakaTime'
import { getConfig } from '@/lib/getConfig'
import { isValidUnit, ventureUnit } from '@/lib/units'

// Mixed-typed money fields can hold legacy non-numeric values; coerce defensively
// so $sort / $group never blow up on one bad document.
const num = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })

// ── VAT defaults ─────────────────────────────────────────────────────────────

/** settings.vat, or null when finance settings cannot be read (legacy behaviour then applies). */
async function loadVatSettings() {
  try {
    const settings = await getFinanceSettings()
    return settings?.vat ?? null
  } catch (err) {
    console.error('[api/invoices] finance settings unavailable', err)
    return null
  }
}

const isBlank = (v) => v === undefined || v === null || v === ''

/** Rate a treatment implies when the body gives none (company default rate for the company default treatment). */
function defaultRateFor(treatment, vat) {
  if (vat && treatment === vat.defaultSalesTreatment && Number.isFinite(Number(vat.defaultSalesRate)))
    return Number(vat.defaultSalesRate)
  return VAT_TREATMENTS.find(t => t.value === treatment)?.defaultRate ?? 0
}

/**
 * Default VAT setup for a NEW invoice to `client`:
 *   - company not VAT registered (turnover / unregistered) → NONE
 *   - foreign client → ZERO_RATED (export of services)
 *   - otherwise finance settings vat.defaultSalesTreatment (+ rate + service code)
 * With no readable settings the legacy behaviour (no VAT) applies.
 */
function vatDefaultsFor(vat, client) {
  if (!vat || vat.registrationType !== 'REGISTERED')
    return { vatTreatment: 'NONE', vatRate: 0, serviceCode: null }
  if (client?.vatRegistrationType === 'FOREIGN')
    return { vatTreatment: 'ZERO_RATED', vatRate: 0, serviceCode: vat.defaultServiceCode ?? null }
  const treatment = INVOICE_VAT_TREATMENTS.includes(vat.defaultSalesTreatment) ? vat.defaultSalesTreatment : 'NONE'
  return {
    vatTreatment: treatment,
    vatRate:      treatment === 'NONE' ? 0 : defaultRateFor(treatment, vat),
    serviceCode:  treatment === 'NONE' ? null : (vat.defaultServiceCode ?? null),
  }
}

const cleanText = (v, max) => {
  if (isBlank(v)) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * BDT equivalent of an invoice total. BDT invoices: the total itself. Other
 * currencies: body `totalBDT`, else `fxRate` (BDT per unit) × total, else null
 * (unknown — the tax ledger then records the foreign figure with a note).
 * @returns {{ totalBDT: number|null } | { error: string }}
 */
function resolveTotalBDT(currency, total, { totalBDT, fxRate } = {}) {
  if (currency === BASE_CURRENCY) return { totalBDT: round2(total) }
  if (!isBlank(totalBDT)) {
    const v = Number(totalBDT)
    if (!Number.isFinite(v) || v <= 0) return { error: 'BDT equivalent of the total must be a positive amount' }
    return { totalBDT: round2(v) }
  }
  if (!isBlank(fxRate)) {
    const r = Number(fxRate)
    if (!Number.isFinite(r) || r <= 0) return { error: 'Exchange rate must be a positive number (BDT per unit)' }
    return { totalBDT: round2(Number(total) * r) }
  }
  return { totalBDT: null }
}

// GET /api/invoices?view=vat-defaults&clientId=… — what the invoice form should
// pre-select. Lives here (not /api/finance/settings) so sales staff who can raise
// invoices but hold no finance/tax permission still get the company's defaults.
async function vatDefaultsResponse(session, searchParams) {
  if (!canDoAny(session, ['sales.invoices.create', 'sales.invoices.update']))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const clientId = searchParams.get('clientId')
  let client = null
  if (clientId) {
    if (!isValidObjectId(clientId)) return NextResponse.json({ error: 'Invalid client' }, { status: 400 })
    client = await Client.findById(clientId).select('vatRegistrationType bin vatNumber').lean()
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const vat = await loadVatSettings()
  const defaults = vatDefaultsFor(vat, client)
  const legacyBin = client?.vatNumber && BIN_REGEX.test(String(client.vatNumber).replace(/\s/g, ''))
  return NextResponse.json({
    data: {
      ...defaults,
      registrationType: vat?.registrationType ?? null,
      settingsAvailable: !!vat,
      client: client
        ? { vatRegistrationType: client.vatRegistrationType ?? null, hasBin: !!(client.bin || legacyBin) }
        : null,
    },
  })
}

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

// Words the list shows for stored codes, so typing what is on screen finds it
// (each value's own words count too: 'partially paid', 'zero rated').
const STATUS_WORDS = {
  DRAFT: 'Draft', SENT: 'Sent', PARTIALLY_PAID: 'Partial', PAID: 'Paid', OVERDUE: 'Overdue', CANCELLED: ['Cancelled', 'Canceled'],
}
const VAT_WORDS = {
  STANDARD: 'Standard rate', REDUCED: 'Reduced rate', ZERO_RATED: ['Zero-rated', 'Export'], EXEMPT: 'Exempt', NONE: ['No VAT', 'Non-VAT'],
}

/**
 * Resolve free-text search into an extra $match clause over every column the
 * list shows: invoice number and combined invoice number (separators ignored;
 * a combined number finds the invoices it groups), project code / name, client
 * code / company / contact person / owner name — refs resolved to id sets
 * first —, status and VAT treatment words, service code, and amounts equal to
 * the total, paid or due figure.
 */
async function buildSearchClause(search) {
  const rx   = ciContains(search)
  const code = codeContains(search)

  const [projects, clients, users, combined] = await Promise.all([
    Project.find({ $or: [{ name: rx }, ...(code ? [{ projectCode: code }] : [])] }).select('_id').lean(),
    Client.find({ $or: [{ company: rx }, { contactPerson: rx }, ...(code ? [{ clientCode: code }] : [])] }).select('_id').lean(),
    User.find({ name: rx }).select('_id').lean(),
    code ? CombinedInvoice.find({ combinedNumber: code }).select('projectId clientId').lean() : [],
  ])

  const clientIds = new Set(clients.map(c => c._id.toString()))
  if (users.length > 0) {
    const viaUser = await Client.find({ userId: { $in: users.map(u => u._id) } }).select('_id').lean()
    viaUser.forEach(c => clientIds.add(c._id.toString()))
  }

  const projectIds = projects.map(p => p._id)
  const clientOids = [...clientIds].map(toObjectId)

  const or = [{ serviceCode: rx }]
  if (code) or.push({ invoiceNumber: code })
  if (projectIds.length) or.push({ projectId: { $in: projectIds } }, { projectIds: { $in: projectIds } })
  if (clientOids.length) or.push({ clientId: { $in: clientOids } })

  // A combined invoice groups its project's billable invoices billed to its
  // client (lib/combinedInvoice buildCombined) — one clause per client.
  const combinedByClient = new Map()
  for (const c of combined) {
    const key = c.clientId?.toString()
    if (!key || !c.projectId) continue
    if (!combinedByClient.has(key)) combinedByClient.set(key, [])
    combinedByClient.get(key).push(c.projectId)
  }
  for (const [cid, pids] of combinedByClient) {
    or.push({
      clientId: toObjectId(cid),
      status:   { $nin: NON_BILLABLE_STATUSES },
      $or:      [{ projectId: { $in: pids } }, { projectIds: { $in: pids } }],
    })
  }

  const statuses = wordMatches(search, STATUS_WORDS)
  if (statuses.length) or.push({ status: { $in: statuses } })
  const treatments = wordMatches(search, VAT_WORDS)
  if (treatments.length) or.push({ vatTreatment: { $in: treatments } })
  // Invoices saved before VAT support carry no treatment: they are "No VAT".
  if (treatments.includes('NONE')) or.push({ vatTreatment: null })

  // Money is Mixed (numbers or legacy strings), so compare numerically — the
  // same total / paid / due figures the list shows.
  const amount = amountQuery(search)
  if (amount != null) {
    const total = num('total')
    or.push(amountEquals(amount, [
      total,
      num('paidAmount'),
      { $max: [0, { $subtract: [total, { $min: [num('paidAmount'), total] }] }] },
    ]))
  }
  return { $or: or }
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    if (searchParams.get('view') === 'vat-defaults') {
      await connectDB()
      return await vatDefaultsResponse(session, searchParams)
    }

    // Staff need sales.invoices.view; CLIENT is scoped to own company below;
    // FREELANCER / VENDOR have no access to invoices.
    const isClient = session.user.role === 'CLIENT'
    if (!isClient && !canDo(session, 'sales.invoices.view'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const page      = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit     = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const status    = searchParams.get('status')
    const clientId  = searchParams.get('clientId')
    const projectId = searchParams.get('projectId')
    const venture   = searchParams.get('venture')
    const search    = searchParams.get('search')?.trim().slice(0, 100)
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const dateField = searchParams.get('dateField') === 'dueDate' ? 'dueDate' : 'issueDate'
    const groupBy   = searchParams.get('groupBy')
    const sortKey   = SORT_FIELDS[searchParams.get('sort')] ? searchParams.get('sort') : 'createdAt'
    const sortDir   = searchParams.get('dir') === 'asc' ? 1 : -1
    const skip      = (page - 1) * limit

    const and = []
    if (clientId) and.push({ clientId: toObjectId(clientId) })

    // Match both new (projectId) and legacy (projectIds array) styles.
    // projectId=none → standalone invoices (no project at all).
    if (projectId === 'none') {
      and.push({ projectId: null, $or: [{ projectIds: { $exists: false } }, { projectIds: { $size: 0 } }] })
    } else if (projectId) {
      const oid = toObjectId(projectId)
      and.push({ $or: [{ projectId: oid }, { projectIds: oid }] })
    }

    // Venture lives on the project, so resolve it to a project id set first.
    if (venture) {
      const vp = await Project.find({ venture }).select('_id').lean()
      const ids = vp.map(p => p._id)
      and.push(ids.length ? { $or: [{ projectId: { $in: ids } }, { projectIds: { $in: ids } }] } : { _id: null })
    }

    // 'YYYY-MM-DD' filters are Asia/Dhaka calendar days (end day inclusive),
    // independent of the server's timezone.
    if (startDate || endDate) {
      const range = {}
      if (startDate) range.$gte = parseDhakaDay(startDate)?.start ?? new Date(startDate)
      if (endDate) {
        const day = parseDhakaDay(endDate)
        if (day) range.$lt = day.next
        else {
          const end = new Date(endDate)
          end.setHours(23, 59, 59, 999)
          range.$lte = end
        }
      }
      for (const k of ['$gte', '$lt', '$lte']) {
        if (range[k] && Number.isNaN(range[k].getTime()))
          return NextResponse.json({ error: 'Invalid date filter' }, { status: 400 })
      }
      and.push({ [dateField]: range })
    }

    if (search) and.push(await buildSearchClause(search))

    // CLIENT role: only the active company's issued invoices
    if (isClient) {
      const { clientId: activeId } = await resolveActiveClient(session)
      and.push({ clientId: activeId ?? null })
      and.push({ status: { $ne: 'DRAFT' } })
    }

    // Everything except the status tab — used for the per-status tab counts, so
    // choosing a tab doesn't hide the other tabs' counts.
    const matchAnyStatus = and.length ? { $and: [...and] } : {}
    if (status) and.push({ status })
    const match = and.length ? { $and: and } : {}

    // DRAFT / CANCELLED invoices are not billed: they never count towards
    // billed / paid / due money figures (matches lib/combinedInvoice).
    const billableOnly = (expr) => ({ $cond: [{ $in: ['$status', NON_BILLABLE_STATUSES] }, 0, expr] })

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
            // Project invoices group by project; standalone ones (no project)
            // group per client, so a row never mixes several clients.
            _id: {
              p: { $ifNull: ['$projectId', { $ifNull: [{ $arrayElemAt: ['$projectIds', 0] }, null] }] },
              c: { $cond: [{ $ifNull: ['$projectId', { $arrayElemAt: ['$projectIds', 0] }] }, null, '$clientId'] },
            },
            clientId: { $first: '$clientId' },
            count:    { $sum: 1 },
            total:    { $sum: billableOnly('$_total') },
            paid:     { $sum: billableOnly('$_paid') },
            due:      { $sum: billableOnly('$_due') },
            cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
            draftCount:   { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
            overdueCount: { $sum: { $cond: [{ $eq: ['$status', 'OVERDUE'] }, 1, 0] } },
            paidCount:    { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
            lastIssued:   { $max: '$issueDate' },
            nextDue:      { $min: { $cond: [{ $and: [{ $gt: ['$_due', 0] }, { $not: [{ $in: ['$status', NON_BILLABLE_STATUSES] }] }] }, '$dueDate', null] } },
          },
        },
        { $sort: { due: -1, total: -1, _id: 1 } },   // _id keeps paging stable on ties
        {
          $facet: {
            rows:  [{ $skip: skip }, { $limit: limit }],
            count: [{ $count: 'n' }],
          },
        },
      ])

      const rows  = grouped[0]?.rows ?? []
      const total = grouped[0]?.count?.[0]?.n ?? 0

      const projectIds = rows.map(r => r._id?.p).filter(Boolean)
      const [projects, combined] = await Promise.all([
        Project.find({ _id: { $in: projectIds } }).select('name projectCode venture category budget').lean(),
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
          const key = r._id?.p?.toString()
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
            cancelledCount: r.cancelledCount,
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

    const [rows, countRes, statsRes, tabRes] = await Promise.all([
      Invoice.aggregate([
        { $match: match },
        // The rows are returned raw; the buyer's e-TIN is confidential (INVOICE_PII).
        { $project: { 'buyer.tin': 0 } },
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
      // Tab counts ignore the status filter (see matchAnyStatus).
      status
        ? Invoice.aggregate([{ $match: matchAnyStatus }, { $group: { _id: '$status', count: { $sum: 1 } } }])
        : null,
    ])

    // Only the fields the list shows — the full Client doc carries staff-only
    // notes / KYC and contact PII that must not leak through this endpoint.
    await Invoice.populate(rows, [
      { path: 'clientId', select: 'company clientCode userId', populate: { path: 'userId', select: 'name avatar' } },
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
      if (NON_BILLABLE_STATUSES.includes(s._id)) continue
      billed    += s.total
      collected += s.paid
      outstanding += s.due
      if (s._id === 'OVERDUE') overdueAmount += s.due
    }

    // Per-status tab counts over the filter set WITHOUT the status tab applied.
    const statusCounts = {}
    let allCount = 0
    for (const s of (tabRes ?? statsRes)) { statusCounts[s._id] = s.count; allCount += s.count }

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
        statusCounts,
        allCount,
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

    const body = (await request.json()) ?? {}
    const {
      clientId, projectId, items, issueDate, dueDate, taxRate, discount, notes, terms, currency,
      vatTreatment, vatRate, serviceCode, deliveryDestination, totalBDT: bodyTotalBDT, fxRate, unit: bodyUnit,
    } = body

    const invCurrency = isBlank(currency) ? BASE_CURRENCY : String(currency).trim().toUpperCase()
    if (!isValidCurrency(invCurrency)) return NextResponse.json({ error: 'Unsupported currency' }, { status: 422 })

    if (!clientId) return NextResponse.json({ error: 'Client required' }, { status: 422 })
    if (!isValidObjectId(clientId)) return NextResponse.json({ error: 'Invalid client' }, { status: 422 })
    if (projectId && !isValidObjectId(projectId)) return NextResponse.json({ error: 'Invalid project' }, { status: 422 })

    const client = await Client.findById(clientId).select('vatRegistrationType').lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 422 })

    // A project invoice must bill the project's own client — otherwise that
    // client's portal would show another company's project, and the project's
    // rollup / payments would mix two clients' money.
    let project = null
    if (projectId) {
      project = await Project.findById(projectId).select('clientId venture').lean()
      if (!project) return NextResponse.json({ error: 'Project not found', field: 'projectId' }, { status: 422 })
      if (String(project.clientId) !== String(clientId))
        return NextResponse.json({ error: 'This project belongs to another client', field: 'projectId' }, { status: 422 })
    }

    // Business unit (lib/units.js): a project invoice belongs to the project's
    // venture; a standalone invoice needs the venture / product / Company chosen.
    const fromProject = ventureUnit(project?.venture || null)
    const unit = fromProject || (typeof bodyUnit === 'string' ? bodyUnit.trim() : '')
    if (!unit)
      return NextResponse.json({ error: 'Choose the venture or product this invoice is for (or Company / shared)', field: 'unit' }, { status: 422 })
    if (!fromProject && !isValidUnit(unit, await getConfig()))
      return NextResponse.json({ error: 'Unknown venture or product — choose one from the list', field: 'unit' }, { status: 422 })

    // VAT setup: the body wins; otherwise the company default from finance
    // settings (foreign clients → zero-rated export of services).
    const vat = await loadVatSettings()
    const defaults = isBlank(vatTreatment) ? vatDefaultsFor(vat, client) : null
    const treatment = defaults ? defaults.vatTreatment : String(vatTreatment).toUpperCase()
    if (!INVOICE_VAT_TREATMENTS.includes(treatment))
      return NextResponse.json({ error: 'Invalid VAT treatment' }, { status: 422 })
    if (treatment !== 'NONE' && vat && vat.registrationType !== 'REGISTERED')
      return NextResponse.json({
        error: 'The company is not VAT registered (Tax & VAT → Tax Settings), so invoices cannot carry VAT. Choose "No VAT".',
      }, { status: 422 })

    const defaultVatRate = !isBlank(vatRate) ? vatRate : (defaults ? defaults.vatRate : defaultRateFor(treatment, vat))

    // Recalculate + validate totals server-side (quantity > 0, rate >= 0,
    // discount within bounds, VAT/SD rates in range) so a total can never go negative
    const calc = computeInvoiceTotals({ items, taxRate, discount, vatTreatment: treatment, defaultVatRate })
    if (calc.error) return NextResponse.json({ error: calc.error }, { status: 422 })
    const { items: processedItems, subtotal, taxAmount: taxAmt, total } = calc

    const bdt = resolveTotalBDT(invCurrency, total, { totalBDT: bodyTotalBDT, fxRate })
    if (bdt.error) return NextResponse.json({ error: bdt.error, field: 'totalBDT' }, { status: 422 })

    const svcCode = serviceCode !== undefined
      ? cleanText(serviceCode, 20)
      : (defaults ? defaults.serviceCode : null)

    const invoice = await new Invoice({
      clientId,
      projectId:   projectId || null,
      unit,
      items:       processedItems,
      issueDate:   issueDate ? new Date(issueDate) : new Date(),
      dueDate:     dueDate   ? new Date(dueDate)   : null,
      subtotal,
      taxRate:     calc.taxRate,
      taxAmount:   taxAmt,
      discount:    calc.discount,
      total,
      currency:    invCurrency,
      totalBDT:    bdt.totalBDT,
      vatTreatment:        calc.vatTreatment,
      taxableValue:        calc.taxableValue,
      vatAmount:           calc.vatAmount,
      sdAmount:            calc.sdAmount,
      serviceCode:         treatment === 'NONE' ? null : svcCode,
      deliveryDestination: cleanText(deliveryDestination, 300),
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

    // Only what the form needs back — never the full Client (KYC, e-TIN, contact
    // details, staff notes); the response is masked like GET /api/invoices/:id.
    await invoice.populate([
      {
        path: 'clientId',
        select: 'company clientCode clientType contactPerson bin vatRegistrationType userId',
        populate: { path: 'userId', select: 'name avatar' },
      },
      { path: 'projectId', select: 'name projectCode venture' },
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'INVOICE',
      entityId: invoice._id.toString(),
      changes:  JSON.stringify({
        invoiceNumber: invoice.invoiceNumber, total: invoice.total, currency: invoice.currency,
        vatTreatment: invoice.vatTreatment, vatAmount: invoice.vatAmount, unit,
      }),
      request,
    })

    return NextResponse.json({
      data: maskDoc(session, invoice.toJSON(), INVOICE_PII),
      combined: combined ? { id: combined._id.toString(), combinedNumber: combined.combinedNumber } : null,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
