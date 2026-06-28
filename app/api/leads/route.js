export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead, Employee } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { maskList, LEAD_PII } from '@/lib/pii'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { z } from 'zod'

const createLeadSchema = z.object({
  name:             z.string().min(1, 'Name is required'),
  designation:      z.string().optional().nullable(),
  email:            z.string().email().optional().nullable(),
  phone:            z.string().optional().nullable(),
  alternativePhone: z.string().optional().nullable(),
  company:          z.string().optional().nullable(),
  location:         z.string().optional().nullable(),
  status:           z.enum(['NEW','CONTACTED','PROPOSAL_SENT','NEGOTIATION','WON','LOST']).default('NEW'),
  priority:         z.enum(['LOW','NORMAL','HIGH','URGENT']).default('NORMAL'),
  category:         z.string().optional().nullable(),
  service:          z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  platform:         z.string().optional().nullable(),
  reference:        z.string().optional().nullable(),
  referenceType:    z.enum(['CLIENT', 'EMPLOYEE', 'LEAD']).optional().nullable(),
  referenceId:      z.string().optional().nullable(),
  links:            z.array(z.string().url()).optional().default([]),
  sendingDate:      z.string().optional().nullable(),
  followUpDate:     z.string().optional().nullable(),
  value:            z.number().positive().optional().nullable(),
  notes:            z.string().optional().nullable(),
  assignedToId:     z.string().optional().nullable(),
  businessCategory: z.string().optional().nullable(),
})

// GET /api/leads
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.leads.view')   // admin-only leads pipeline (PII)
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page     = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit    = parseInt(searchParams.get('limit') ?? '20', 10)
    const status   = searchParams.get('status')
    const priority = searchParams.get('priority')
    const platform = searchParams.get('platform')
    const source   = searchParams.get('source')
    const search   = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo   = searchParams.get('dateTo')
    const skip     = (page - 1) * limit

    // status/priority are NOT encrypted → safe DB filters. platform/source ARE
    // encrypted → must be matched in JS (DB equality can't match ciphertext).
    const filter = {}
    if (status)   filter.status   = status
    if (priority) filter.priority = priority

    if (dateFrom || dateTo) {
      filter.createdAt = {}
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom)
      if (dateTo)   filter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    // Employees only see leads assigned to them
    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).lean()
      filter.assignedToId = employee?._id ?? null
    }

    const populate = { path: 'assignedToId', populate: { path: 'userId', select: 'name avatar' } }

    let leads, total
    if (search || platform || source) {
      // name/email/company/phone/reference/location + platform/source are encrypted
      ;({ docs: leads, total } = await searchEncrypted(Lead, {
        baseFilter: filter,
        search,
        fields: ['name', 'email', 'company', 'phone', 'reference', 'location'],
        equals: [{ field: 'platform', value: platform }, { field: 'source', value: source }],
        page, limit, sort: { createdAt: -1 }, populate,
      }))
    } else {
      ;[leads, total] = await Promise.all([
        Lead.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).populate(populate),
        Lead.countDocuments(filter),
      ])
    }

    const data = maskList(session, leads.map(l => (l.toJSON ? l.toJSON() : l)), LEAD_PII)

    return NextResponse.json({
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/leads]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/leads
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.leads.create')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = createLeadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.followUpDate) data.followUpDate = new Date(data.followUpDate)
    if (data.sendingDate)  data.sendingDate  = new Date(data.sendingDate)

    const lead = await new Lead(data).save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'LEAD',
      entityId: lead._id.toString(),
      changes:  JSON.stringify({ name: parsed.data.name, status: lead.status }),
      request,
    })

    return NextResponse.json({ data: lead }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
