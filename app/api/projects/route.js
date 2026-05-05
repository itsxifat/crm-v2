export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Client } from '@/models'
import { calcPeriodEnd } from '@/lib/ventures'
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
  discount:         z.coerce.number().min(0).optional(),
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
    const page        = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit       = parseInt(searchParams.get('limit') ?? '20', 10)
    const venture        = searchParams.get('venture')
    const projectType    = searchParams.get('projectType')
    const status         = searchParams.get('status')
    const search         = searchParams.get('search')
    const clientIdFilter = searchParams.get('clientId')
    const skip           = (page - 1) * limit

    const filter = {}
    if (venture)        filter.venture     = venture
    if (projectType)    filter.projectType = projectType
    if (status)         filter.status      = status
    if (clientIdFilter) filter.clientId    = clientIdFilter
    if (search) {
      filter.$or = [
        { name:        { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ]
    }
    if (session.user.role === 'CLIENT') {
      const client = await Client.findOne({ userId: session.user.id }).lean()
      if (client) filter.clientId = client._id
    }
    if (['EMPLOYEE','FREELANCER'].includes(session.user.role)) {
      filter.$or = [
        { projectManagerId: session.user.id },
        { teamMembers: session.user.id },
      ]
    }

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .skip(skip).limit(limit).sort({ createdAt: -1 })
        .populate({ path: 'clientId', populate: { path: 'userId', select: 'name avatar' } })
        .populate('projectManagerId', 'name avatar'),
      Project.countDocuments(filter),
    ])

    const enriched = projects.map(p => {
      const j = p.toJSON()
      // cash-basis profit: what client paid minus what we spent
      j.profit = (j.paidAmount ?? 0) - (j.approvedExpenses ?? 0)
      // contracted profit: full budget value minus costs (regardless of payment)
      j.contractedProfit = (j.budget ?? 0) - (j.discount ?? 0) - (j.approvedExpenses ?? 0)
      return j
    })

    return NextResponse.json({
      data: enriched,
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const body   = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const data = { ...parsed.data }
    delete data.orderDate                                  // always set server-side
    data.orderDate  = new Date()
    const startDate = data.startDate ? new Date(data.startDate) : new Date()
    data.startDate  = startDate

    if (data.deadline) data.deadline = new Date(data.deadline)
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
      { path: 'clientId', populate: { path: 'userId', select: 'name avatar' } },
      { path: 'projectManagerId', select: 'name avatar' },
    ])
    const j = project.toJSON()
    j.profit = (j.paidAmount ?? 0) - (j.approvedExpenses ?? 0)
    j.contractedProfit = (j.budget ?? 0) - (j.discount ?? 0) - (j.approvedExpenses ?? 0)
    return NextResponse.json({ data: j }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
