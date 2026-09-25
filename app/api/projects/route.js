export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Vendor, ProjectVendor } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import { canDo, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { canViewProjectFinancials } from '@/lib/projectAccess'
import { calcPeriodEnd } from '@/lib/ventures'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { z } from 'zod'

const schema = z.object({
  name:             z.string().min(1),
  description:      z.string().optional().nullable(),
  clientId:         z.string().min(1),
  venture:          z.string().min(1),
  category:         z.string().min(1),
  subcategory:      z.string().optional().nullable(),
  projectType:      z.enum(['FIXED','MONTHLY']),
  projectManagerId: z.string().optional().nullable(),
  teamMembers:      z.array(z.string()).optional(),
  status:           z.string().optional(),
  priority:         z.enum(['LOW','MEDIUM','HIGH','URGENT']).default('MEDIUM'),
  startDate:        z.string().optional().nullable(),
  deadline:         z.string().optional().nullable(),
  budget:           z.coerce.number().min(0).optional(),
  currency:         z.string().default('BDT'),
  tags:             z.string().optional().nullable(),
})

// GET /api/projects?venture=&projectType=&status=&search=&page=&limit=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page        = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit       = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const venture        = searchParams.get('venture')
    const projectType    = searchParams.get('projectType')
    const status         = searchParams.get('status')
    const search         = searchParams.get('search')
    const clientIdFilter = searchParams.get('clientId')
    const startDateParam = searchParams.get('startDate')
    const endDateParam   = searchParams.get('endDate')
    const skip           = (page - 1) * limit

    if (clientIdFilter && !isValidObjectId(clientIdFilter))
      return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })

    // Date range on the project start date, as Asia/Dhaka calendar days
    // ('YYYY-MM-DD'); endDate is inclusive.
    const rangeFrom = startDateParam ? parseDhakaDay(startDateParam) : null
    const rangeTo   = endDateParam   ? parseDhakaDay(endDateParam)   : null
    if ((startDateParam && !rangeFrom) || (endDateParam && !rangeTo))
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })

    const filter = {}
    if (venture)        filter.venture     = venture
    if (projectType)    filter.projectType = projectType
    if (status)         filter.status      = status
    if (clientIdFilter) filter.clientId    = clientIdFilter
    if (rangeFrom || rangeTo) {
      filter.startDate = {}
      if (rangeFrom) filter.startDate.$gte = rangeFrom.start
      if (rangeTo)   filter.startDate.$lt  = rangeTo.next
    }

    // Ownership scoping (kept separate from search so neither clobbers the other)
    const role = session.user.role
    if (role === 'CLIENT') {
      const { clientId } = await resolveActiveClient(session)
      // No resolvable company → no projects (avoid leaking all projects)
      filter.clientId = clientId ?? null
    } else if (role === 'VENDOR') {
      // Vendors only see projects they are explicitly linked to.
      const vendor = await Vendor.findOne({ userId: session.user.id }).select('_id').lean()
      const links  = vendor ? await ProjectVendor.find({ vendorId: vendor._id }).select('projectId').lean() : []
      filter._id = { $in: links.map(l => l.projectId) }
    } else if (
      role === 'EMPLOYEE' || role === 'FREELANCER' ||
      (role === 'MANAGER' && !canDo(session, 'projects.view'))
    ) {
      filter.$or = [
        { projectManagerId: session.user.id },
        { teamMembers: session.user.id },
      ]
    } else if (role !== 'SUPER_ADMIN' && role !== 'MANAGER') {
      filter._id = { $in: [] }
    }

    const populate = [
      { path: 'clientId', select: 'userId clientCode clientType company contactPerson', populate: { path: 'userId', select: 'name avatar' } },
      { path: 'projectManagerId', select: 'name avatar' },
    ]
    const showFinancials = canViewProjectFinancials(session)
    const VENDOR_FIELDS  = ['id', 'projectCode', 'name', 'venture', 'category', 'status', 'startDate', 'deadline']
    const enrich = (p) => {
      const j = p.toJSON()
      if (role === 'VENDOR') return Object.fromEntries(VENDOR_FIELDS.map(k => [k, j[k] ?? null]))
      if (!showFinancials) {
        // Internal cost / margin data — same stripping as GET /api/projects/:id
        for (const k of ['budget', 'paidAmount', 'approvedExpenses', 'profit', 'dueAmount', 'budgetUtilization']) delete j[k]
        return j
      }
      // cash-basis profit: what client paid minus what we spent
      j.profit = (j.paidAmount ?? 0) - (j.approvedExpenses ?? 0)
      // contracted profit: full budget value minus costs (regardless of payment)
      j.contractedProfit = (j.budget ?? 0) - (j.approvedExpenses ?? 0)
      return j
    }

    let projects, total
    if (search) {
      // name/description are encrypted → DB regex can't match; filter in JS
      ;({ docs: projects, total } = await searchEncrypted(Project, {
        baseFilter: filter, search, fields: ['name', 'description'],
        page, limit, sort: { createdAt: -1 }, populate,
      }))
    } else {
      ;[projects, total] = await Promise.all([
        Project.find(filter)
          .skip(skip).limit(limit).sort({ createdAt: -1 })
          .populate(populate[0]).populate(populate[1]),
        Project.countDocuments(filter),
      ])
    }

    return NextResponse.json({
      data: projects.map(enrich),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.create')
    if (denied) return denied
    await connectDB()

    const body   = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const data = { ...parsed.data }
    delete data.orderDate                                  // always set server-side
    data.orderDate  = new Date()
    // Date-only values are stored as UTC midnight of the calendar day; the
    // default is today's date in the business timezone (Asia/Dhaka).
    const startDate = new Date(data.startDate || dhakaDayKey())
    data.startDate  = startDate

    // Monthly retainers have billing periods, not a deadline.
    if (data.projectType === 'MONTHLY') delete data.deadline
    else if (data.deadline) data.deadline = new Date(data.deadline)
    if (!data.status) {
      data.status = data.projectType === 'MONTHLY' ? 'ACTIVE' : 'PENDING'
    }

    if (data.projectType === 'MONTHLY') {
      data.currentPeriodStart = startDate
      data.currentPeriodEnd   = calcPeriodEnd(startDate)
      data.billingDay         = startDate.getDate()
      data.nextBillingDate    = data.currentPeriodEnd
    }

    const project = await new Project(data).save()
    await project.populate([
      { path: 'clientId', select: 'userId clientCode clientType company contactPerson', populate: { path: 'userId', select: 'name avatar' } },
      { path: 'projectManagerId', select: 'name avatar' },
    ])
    const j = project.toJSON()
    j.profit = (j.paidAmount ?? 0) - (j.approvedExpenses ?? 0)
    j.contractedProfit = (j.budget ?? 0) - (j.approvedExpenses ?? 0)

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'PROJECT',
      entityId: project._id.toString(),
      changes:  JSON.stringify({ name: project.name, status: project.status }),
      request,
    })

    return NextResponse.json({ data: j }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
