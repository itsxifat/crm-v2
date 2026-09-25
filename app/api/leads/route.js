export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskList, maskDoc, LEAD_PII } from '@/lib/pii'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { LEAD_ASSIGNEE_POPULATE, getOwnEmployeeId, leadLinkSchema } from '@/lib/leadAccess'
import { isValidObjectId } from '@/lib/objectId'
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
  subcategory:      z.string().optional().nullable(),
  service:          z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  platform:         z.string().optional().nullable(),
  reference:        z.string().optional().nullable(),
  referenceType:    z.enum(['CLIENT', 'EMPLOYEE', 'LEAD']).optional().nullable(),
  referenceId:      z.string().optional().nullable(),
  links:            z.array(leadLinkSchema).optional().default([]),
  sendingDate:      z.string().optional().nullable(),
  followUpDate:     z.string().optional().nullable(),
  value:            z.number().nonnegative().optional().nullable(),
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

    // Dates are 'yyyy-MM-dd' calendar days in the business timezone (Asia/Dhaka, UTC+6)
    const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d)
    if ((dateFrom && isDay(dateFrom)) || (dateTo && isDay(dateTo))) {
      filter.createdAt = {}
      if (dateFrom && isDay(dateFrom)) filter.createdAt.$gte = new Date(`${dateFrom}T00:00:00.000+06:00`)
      if (dateTo && isDay(dateTo))     filter.createdAt.$lte = new Date(`${dateTo}T23:59:59.999+06:00`)
    }

    // Employees only see leads assigned to them (none if they have no Employee profile)
    if (session.user.role === 'EMPLOYEE') {
      const employeeId = await getOwnEmployeeId(session)
      if (!employeeId) {
        return NextResponse.json({ data: [], meta: { page, limit, total: 0, pages: 0 } })
      }
      filter.assignedToId = employeeId
    }

    const populate = LEAD_ASSIGNEE_POPULATE

    let leads, total
    if (search || platform || source) {
      // Only search PII fields the caller may see — otherwise search results
      // would let them rebuild masked values one character at a time.
      const searchFields = ['name', 'company', 'reference']
      if (canDo(session, 'pii.contact.view')) searchFields.push('email', 'phone')
      if (canDo(session, 'pii.address.view')) searchFields.push('location')
      ;({ docs: leads, total } = await searchEncrypted(Lead, {
        baseFilter: filter,
        search,
        fields: searchFields,
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

    // Assigning a lead to someone requires sales.leads.assign; otherwise the
    // lead is assigned to its creator (so an EMPLOYEE can still see it).
    const ownEmployeeId = await getOwnEmployeeId(session)
    if (data.assignedToId) {
      if (!isValidObjectId(data.assignedToId)) {
        return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
      }
      const isSelf = ownEmployeeId && ownEmployeeId.toString() === data.assignedToId
      if (!isSelf && !canDo(session, 'sales.leads.assign')) {
        return NextResponse.json({ error: 'You do not have permission to assign leads' }, { status: 403 })
      }
    } else if (session.user.role === 'EMPLOYEE' || !canDo(session, 'sales.leads.assign')) {
      data.assignedToId = ownEmployeeId ?? null
    } else {
      data.assignedToId = null
    }

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

    return NextResponse.json({ data: maskDoc(session, lead.toJSON(), LEAD_PII) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
