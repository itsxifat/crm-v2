export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import { LeadActivity } from '@/models/Lead'
import { findAccessibleLead } from '@/lib/leadAccess'
import { z } from 'zod'

const activitySchema = z.object({
  type: z.enum(['call', 'email', 'meeting', 'note', 'task']),
  note: z.string().min(1, 'Note is required'),
})

// GET /api/leads/[id]/activities
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.leads.view')
    if (denied) return denied

    await connectDB()

    // EMPLOYEEs may only read activity for leads assigned to them
    const lead = await findAccessibleLead(session, params.id, '_id assignedToId')
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const activities = await LeadActivity.find({ leadId: params.id }).sort({ createdAt: -1 })
    return NextResponse.json({ data: activities })
  } catch (err) {
    console.error('[GET /api/leads/[id]/activities]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/leads/[id]/activities
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.leads.update')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = activitySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    // EMPLOYEEs may only log activity on leads assigned to them
    const lead = await findAccessibleLead(session, params.id, '_id assignedToId')
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const activity = await new LeadActivity({
      leadId:        params.id,
      type:          parsed.data.type,
      note:          parsed.data.note,
      createdById:   session.user.id,
      createdByName: session.user.name ?? session.user.email ?? 'Unknown',
    }).save()

    return NextResponse.json({ data: activity }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads/[id]/activities]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
