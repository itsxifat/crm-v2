export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskDoc, LEAD_PII, restoreMaskedValues } from '@/lib/pii'
import connectDB from '@/lib/mongodb'
import Lead, { LeadActivity } from '@/models/Lead'
import Attachment from '@/models/Attachment'
import { LEAD_ASSIGNEE_POPULATE, canAccessLead, findAccessibleLead, leadLinkSchema } from '@/lib/leadAccess'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
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
  subcategory:      z.string().optional().nullable(),
  service:          z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  platform:         z.string().optional().nullable(),
  reference:        z.string().optional().nullable(),
  referenceType:    z.enum(['CLIENT', 'EMPLOYEE', 'LEAD']).optional().nullable(),
  referenceId:      z.string().optional().nullable(),
  links:            z.array(leadLinkSchema).optional(),
  sendingDate:      z.string().optional().nullable(),
  followUpDate:     z.string().optional().nullable(),
  value:            z.number().nonnegative().optional().nullable(),
  notes:            z.string().optional().nullable(),
  assignedToId:     z.string().optional().nullable(),
  lostReason:       z.string().optional().nullable(),
  businessCategory: z.string().optional().nullable(),
})

// GET /api/leads/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.leads.view')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    await connectDB()

    const lead = await Lead.findById(params.id).populate(LEAD_ASSIGNEE_POPULATE)

    // EMPLOYEEs may only view leads assigned to them
    if (!lead || !(await canAccessLead(session, lead))) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const [activities, attachments] = await Promise.all([
      LeadActivity.find({ leadId: params.id }).sort({ createdAt: -1 }),
      Attachment.find({ leadId: params.id }).sort({ createdAt: -1 }),
    ])

    return NextResponse.json({ data: maskDoc(session, { ...lead.toJSON(), activities, attachments }, LEAD_PII) })
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
  businessCategory: 'Business Category', subcategory: 'Subcategory',
}

// PII fields: never write their before/after values into the activity log
// (activities are shown to users who only see these fields masked).
const PII_KEYS = new Set(['email', 'phone', 'alternativePhone', 'location', 'value'])

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
    if (key === 'notes' || PII_KEYS.has(key)) {
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
    const denied = requirePerm(session, 'sales.leads.update')
    if (denied) return denied

    await connectDB()

    // Fetch before state to diff changes (also enforces EMPLOYEE assignment scoping)
    const before = await findAccessibleLead(session, params.id)
    if (!before) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Edit forms are pre-filled from masked GET responses — put the stored value
    // back for any masked placeholder so it is never written over real data.
    const body   = restoreMaskedValues(await request.json(), before)
    const parsed = updateLeadSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.followUpDate) data.followUpDate = new Date(data.followUpDate)
    if (data.sendingDate)  data.sendingDate  = new Date(data.sendingDate)

    // Reassigning a lead requires sales.leads.assign
    if ('assignedToId' in data) {
      const oldId = before.assignedToId ? before.assignedToId.toString() : null
      const newId = data.assignedToId || null
      if (oldId === newId) {
        delete data.assignedToId
      } else {
        if (!canDo(session, 'sales.leads.assign')) {
          return NextResponse.json({ error: 'You do not have permission to assign leads' }, { status: 403 })
        }
        if (newId && !isValidObjectId(newId)) {
          return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
        }
        data.assignedToId = newId
      }
    }

    const lead = await Lead.findByIdAndUpdate(params.id, data, { new: true })
      .populate(LEAD_ASSIGNEE_POPULATE)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

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

    const statusChanged = data.status && data.status !== before.status
    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   statusChanged ? 'STATUS_CHANGE' : 'UPDATE',
      entity:   'LEAD',
      entityId: params.id,
      changes:  note ?? (statusChanged ? `Status: ${before.status} → ${data.status}` : null),
      request,
    })

    return NextResponse.json({ data: maskDoc(session, lead.toJSON(), LEAD_PII) })
  } catch (err) {
    console.error('[PUT /api/leads/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/leads/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.leads.delete')
    if (denied) return denied

    await connectDB()

    // EMPLOYEEs may only delete leads assigned to them
    const existing = await findAccessibleLead(session, params.id, '_id assignedToId')
    if (!existing) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const deleted = await Lead.findByIdAndDelete(params.id)

    // Don't leave the lead's activity log (change history) and attachment
    // records orphaned
    if (deleted) {
      await Promise.all([
        LeadActivity.deleteMany({ leadId: params.id }),
        Attachment.deleteMany({ leadId: params.id }),
      ])
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'LEAD',
      entityId: params.id,
      changes:  deleted ? JSON.stringify({ name: deleted.name }) : null,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/leads/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
