export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Lead, { LeadActivity } from '@/models/Lead'
import Attachment from '@/models/Attachment'
import Employee from '@/models/Employee'
import { z } from 'zod'

const updateLeadSchema = z.object({
  name:             z.string().min(1).optional(),
  designation:      z.string().optional().nullable(),
  email:            z.string().email().optional().nullable(),
  phone:            z.string().optional().nullable(),
  alternativePhone: z.string().optional().nullable(),
  company:          z.string().optional().nullable(),
  location:         z.string().optional().nullable(),
  status:           z.enum(['NEW','CONTACTED','PROPOSAL_SENT','NEGOTIATION','WON','LOST']).optional(),
  priority:         z.enum(['LOW','NORMAL','HIGH','URGENT']).optional(),
  category:         z.string().optional().nullable(),
  service:          z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  platform:         z.string().optional().nullable(),
  reference:        z.string().optional().nullable(),
  referenceType:    z.enum(['CLIENT', 'EMPLOYEE', 'LEAD']).optional().nullable(),
  referenceId:      z.string().optional().nullable(),
  links:            z.array(z.string()).optional(),
  sendingDate:      z.string().optional().nullable(),
  followUpDate:     z.string().optional().nullable(),
  value:            z.number().positive().optional().nullable(),
  notes:            z.string().optional().nullable(),
  assignedToId:     z.string().optional().nullable(),
  lostReason:       z.string().optional().nullable(),
  businessCategory: z.string().optional().nullable(),
})

// GET /api/leads/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const lead = await Lead.findById(params.id)
      .populate({ path: 'assignedToId', populate: { path: 'userId', select: 'id name avatar email' } })

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const [activities, attachments] = await Promise.all([
      LeadActivity.find({ leadId: params.id }).sort({ createdAt: -1 }),
      Attachment.find({ leadId: params.id }).sort({ createdAt: -1 }),
    ])

    return NextResponse.json({ data: { ...lead.toJSON(), activities, attachments } })
  } catch (err) {
    console.error('[GET /api/leads/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const FIELD_LABELS = {
  name: 'Name', designation: 'Designation', email: 'Email',
  phone: 'Phone', alternativePhone: 'Alt. Phone', company: 'Company',
  location: 'Location', status: 'Status', priority: 'Priority',
  category: 'Category', service: 'Service', source: 'Source',
  platform: 'Platform', reference: 'Reference', sendingDate: 'Sending Date',
  followUpDate: 'Follow-up Date', value: 'Value', notes: 'Notes',
  assignedToId: 'Assigned To', lostReason: 'Lost Reason', links: 'Links',
  businessCategory: 'Business Category',
}

function buildChangeSummary(before, updates) {
  const changes = []
  for (const [key, newVal] of Object.entries(updates)) {
    const oldVal = before[key]
    const label  = FIELD_LABELS[key] ?? key

    if (key === 'links') {
      const oldStr = (oldVal ?? []).join(', ')
      const newStr = (newVal ?? []).join(', ')
      if (oldStr !== newStr) changes.push(`${label} updated`)
      continue
    }
    if (key === 'assignedToId') {
      const oldId = oldVal ? oldVal.toString() : null
      const newId = newVal ? newVal.toString() : null
      if (oldId !== newId) {
        if (newId) changes.push(`${label} changed`)
        else changes.push(`${label} removed`)
      }
      continue
    }
    if (key === 'notes') {
      if ((oldVal ?? '') !== (newVal ?? '')) changes.push(`${label} updated`)
      continue
    }

    const oldStr = oldVal instanceof Date ? oldVal.toISOString().slice(0,10) : String(oldVal ?? '')
    const newStr = newVal instanceof Date ? newVal.toISOString().slice(0,10) : String(newVal ?? '')
    if (oldStr !== newStr) {
      const display = (v) => (v === 'null' || v === '') ? '—' : v
      changes.push(`${label}: ${display(oldStr)} → ${display(newStr)}`)
    }
  }
  return changes.length ? `Updated — ${changes.join(', ')}` : null
}

// PUT /api/leads/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateLeadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.followUpDate) data.followUpDate = new Date(data.followUpDate)
    if (data.sendingDate)  data.sendingDate  = new Date(data.sendingDate)

    // Fetch before state to diff changes
    const before = await Lead.findById(params.id).lean()
    if (!before) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const lead = await Lead.findByIdAndUpdate(params.id, data, { new: true })
      .populate({ path: 'assignedToId', populate: { path: 'userId', select: 'name avatar' } })

    // Auto-log activity for this update
    const note = buildChangeSummary(before, data)
    if (note) {
      await new LeadActivity({
        leadId:        params.id,
        type:          'update',
        note,
        createdById:   session.user.id,
        createdByName: session.user.name ?? session.user.email ?? 'Unknown',
      }).save()
    }

    return NextResponse.json({ data: lead })
  } catch (err) {
    console.error('[PUT /api/leads/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/leads/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    await Lead.findByIdAndDelete(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/leads/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
