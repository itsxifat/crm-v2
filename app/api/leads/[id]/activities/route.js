export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Lead, { LeadActivity } from '@/models/Lead'
import { z } from 'zod'

const activitySchema = z.object({
  type: z.enum(['call', 'email', 'meeting', 'note', 'task']),
  note: z.string().min(1, 'Note is required'),
})

// GET /api/leads/[id]/activities
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body   = await request.json()
    const parsed = activitySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const lead = await Lead.findById(params.id)
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
