export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, CombinedInvoice, Project } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import { invoiceMoney, rollUp, deriveStatus, NON_BILLABLE_STATUSES } from '@/lib/combinedInvoice'
import { ciContains } from '@/lib/searchMatch'
import { isValidObjectId } from '@/lib/objectId'

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { client, error } = await resolveActiveClient(session)
    if (error === 'SELECT_COMPANY') return NextResponse.json({ error: 'SELECT_COMPANY' }, { status: 409 })
    // No company yet (individual client with no workspace) → empty list, not an error.
    if (!client) return NextResponse.json({ invoices: [], projects: [], total: 0, pages: 0, summary: null })

    const clientInfo = { clientCode: client.clientCode, company: client.company }

    const { searchParams } = new URL(request.url)
    const status    = searchParams.get('status')
    const projectId = searchParams.get('projectId')
    const groupBy   = searchParams.get('groupBy')
    const search    = (searchParams.get('search') ?? '').trim().slice(0, 100)
    const page      = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit     = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const skip      = (page - 1) * limit

    if (projectId && !isValidObjectId(projectId))
      return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })

    // The DRAFT exclusion lives in its own $and clause so a user-supplied
    // ?status=DRAFT can never overwrite it and expose unissued drafts.
    const baseFilter = { clientId: client._id, status: { $ne: 'DRAFT' } }
    const and        = [{ status: { $ne: 'DRAFT' } }]
    if (status && status !== 'ALL') and.push({ status: String(status) })
    if (projectId) and.push({ $or: [{ projectId }, { projectIds: projectId }] })
    if (search) {
      // Server-side search (the list is paginated): invoice number, or the name
      // / code of one of this company's projects.
      const matchingProjects = await Project.find({
        clientId: client._id,
        $or: [{ name: ciContains(search) }, { projectCode: ciContains(search) }],
      }).select('_id').lean()
      const pids = matchingProjects.map(p => p._id)
      and.push({ $or: [
        { invoiceNumber: ciContains(search) },
        ...(pids.length ? [{ projectId: { $in: pids } }, { projectIds: { $in: pids } }] : []),
      ] })
    }
    const filter = { clientId: client._id, $and: and }

    // ── Project-wise view ────────────────────────────────────────────────────
    // One row per project: how many invoices, what they total, what is paid and
    // what is still due — plus the combined invoice when there is more than one.
    if (groupBy === 'project') {
      const all = await Invoice.find(filter)
        .populate('projectId',  'name projectCode venture')
        .populate('projectIds', 'name projectCode venture')
        .sort({ issueDate: 1 })
        .lean()

      const groups = new Map()
      for (const inv of all) {
        const proj = inv.projectId ?? inv.projectIds?.[0] ?? null
        const key  = proj?._id?.toString() ?? '__none__'
        if (!groups.has(key)) groups.set(key, { project: proj, invoices: [] })
        groups.get(key).invoices.push(inv)
      }

      const projectIds = [...groups.keys()].filter(k => k !== '__none__')
      const combined   = projectIds.length
        ? await CombinedInvoice.find({ projectId: { $in: projectIds }, clientId: client._id })
            .select('combinedNumber projectId').lean()
        : []
      const combinedByProject = new Map(combined.map(c => [c.projectId.toString(), c]))

      const rows = [...groups.entries()].map(([key, g]) => {
        // Cancelled invoices are listed but never counted in the money / status
        // rollup (same rule as the combined invoice).
        const billable = g.invoices.filter(i => !NON_BILLABLE_STATUSES.includes(i.status))
        const totals = rollUp(billable)
        const cmb    = combinedByProject.get(key)
        const curSet = [...new Set(billable.map(i => i.currency ?? 'BDT'))]
        return {
          projectId: key === '__none__' ? null : key,
          project: g.project
            ? { id: key, name: g.project.name, projectCode: g.project.projectCode, venture: g.project.venture }
            : null,
          combined: cmb && billable.length > 1
            ? { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber }
            : null,
          status: billable.length
            ? deriveStatus(billable.map(i => ({ ...i, ...invoiceMoney(i) })), totals)
            : 'CANCELLED',
          ...totals,
          currency:      curSet.length > 1 ? null : (curSet[0] ?? g.invoices[0]?.currency ?? 'BDT'),
          mixedCurrency: curSet.length > 1,
          invoices: g.invoices.map(i => ({
            id: i._id.toString(),
            invoiceNumber: i.invoiceNumber,
            status: i.status,
            issueDate: i.issueDate,
            dueDate: i.dueDate,
            currency: i.currency ?? 'BDT',
            ...invoiceMoney(i),
          })),
        }
      }).sort((a, b) => b.due - a.due || b.total - a.total)

      return NextResponse.json({ projects: rows, clientInfo, total: rows.length, pages: 1 })
    }

    // ── Flat list ────────────────────────────────────────────────────────────
    const [invoices, total, allForSummary] = await Promise.all([
      Invoice.find(filter)
        .populate('projectId',  'name projectCode')
        .populate('projectIds', 'name projectCode')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(filter),
      // Summary always spans every issued invoice, regardless of the status tab.
      Invoice.find(baseFilter).select('status total paidAmount dueDate currency projectId projectIds').lean(),
    ])

    // Billable invoice count per project — the combined link is only shown when
    // a project has more than one issued invoice (same rule as the other routes).
    const billableByProject = new Map()
    for (const i of allForSummary) {
      if (NON_BILLABLE_STATUSES.includes(i.status)) continue
      const key = (i.projectId ?? i.projectIds?.[0])?.toString()
      if (key) billableByProject.set(key, (billableByProject.get(key) ?? 0) + 1)
    }

    const projectIds = [...new Set(
      invoices.map(i => (i.projectId?._id ?? i.projectIds?.[0]?._id)?.toString()).filter(Boolean)
    )]
    const combined = projectIds.length
      ? await CombinedInvoice.find({ projectId: { $in: projectIds }, clientId: client._id })
          .select('combinedNumber projectId').lean()
      : []
    const combinedByProject = new Map(combined.map(c => [c.projectId.toString(), c]))

    const now      = new Date()
    const settled  = allForSummary.filter(i => !NON_BILLABLE_STATUSES.includes(i.status))
    const totals   = rollUp(settled)
    // Overdue = explicitly OVERDUE, or issued/part-paid and past its due date with
    // money still owed (status is only flipped when staff open the invoice).
    const isOverdue = (i) =>
      i.status === 'OVERDUE' ||
      (['SENT', 'PARTIALLY_PAID'].includes(i.status) && i.dueDate && new Date(i.dueDate) < now && invoiceMoney(i).due > 0.01)
    const overdue  = settled.filter(isOverdue)

    // Amounts are never converted between currencies (there is no FX table), so
    // report a per-currency breakdown and flag when the single totals mix them.
    const currencies = [...new Set(settled.map(i => i.currency ?? 'BDT'))]
    const mixedCurrency = currencies.length > 1
    const byCurrency = currencies.map(cur => {
      const list = settled.filter(i => (i.currency ?? 'BDT') === cur)
      const t    = rollUp(list)
      const od   = list.filter(isOverdue)
      return {
        currency:      cur,
        billed:        t.total,
        collected:     t.paidAmount,
        outstanding:   t.due,
        overdueCount:  od.length,
        overdueAmount: round2(rollUp(od).due),
        invoiceCount:  list.length,
      }
    })

    return NextResponse.json({
      invoices: invoices.map(i => {
        const pid = (i.projectId?._id ?? i.projectIds?.[0]?._id)?.toString()
        const cmb = pid ? combinedByProject.get(pid) : null
        return {
          ...i,
          id: i._id.toString(),
          ...invoiceMoney(i),
          combined: cmb && (billableByProject.get(pid) ?? 0) > 1
            ? { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber }
            : null,
          clientInfo,
        }
      }),
      total,
      pages: Math.ceil(total / limit),
      summary: {
        billed:      totals.total,
        collected:   totals.paidAmount,
        outstanding: totals.due,
        overdueCount:  overdue.length,
        overdueAmount: round2(rollUp(overdue).due),
        invoiceCount:  settled.length,
        currency:      mixedCurrency ? null : (currencies[0] ?? 'BDT'),
        mixedCurrency,
        byCurrency,
      },
    })
  } catch (err) {
    console.error('[GET /api/client/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
