export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, CombinedInvoice } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import { invoiceMoney, rollUp, deriveStatus } from '@/lib/combinedInvoice'

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
    const page      = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip      = (page - 1) * limit

    const baseFilter = { clientId: client._id, status: { $ne: 'DRAFT' } }
    const filter     = { ...baseFilter }
    if (status && status !== 'ALL') filter.status = status
    if (projectId) filter.$or = [{ projectId }, { projectIds: projectId }]

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
        const totals = rollUp(g.invoices)
        const cmb    = combinedByProject.get(key)
        return {
          projectId: key === '__none__' ? null : key,
          project: g.project
            ? { id: key, name: g.project.name, projectCode: g.project.projectCode, venture: g.project.venture }
            : null,
          combined: cmb && g.invoices.length > 1
            ? { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber }
            : null,
          status: deriveStatus(g.invoices.map(i => ({ ...i, ...invoiceMoney(i) })), totals),
          ...totals,
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
      Invoice.find(baseFilter).select('status total paidAmount dueDate').lean(),
    ])

    const projectIds = [...new Set(
      invoices.map(i => (i.projectId?._id ?? i.projectIds?.[0]?._id)?.toString()).filter(Boolean)
    )]
    const combined = projectIds.length
      ? await CombinedInvoice.find({ projectId: { $in: projectIds }, clientId: client._id })
          .select('combinedNumber projectId').lean()
      : []
    const combinedByProject = new Map(combined.map(c => [c.projectId.toString(), c]))

    const settled  = allForSummary.filter(i => i.status !== 'CANCELLED')
    const totals   = rollUp(settled)
    const overdue  = settled.filter(i => i.status === 'OVERDUE')

    return NextResponse.json({
      invoices: invoices.map(i => {
        const pid = (i.projectId?._id ?? i.projectIds?.[0]?._id)?.toString()
        const cmb = pid ? combinedByProject.get(pid) : null
        return {
          ...i,
          id: i._id.toString(),
          ...invoiceMoney(i),
          combined: cmb ? { id: cmb._id.toString(), combinedNumber: cmb.combinedNumber } : null,
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
      },
    })
  } catch (err) {
    console.error('[GET /api/client/invoices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
