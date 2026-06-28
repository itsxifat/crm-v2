export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation, Lead, LeadActivity } from '@/models'
import { createNotification } from '@/lib/createNotification'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'

const TRANSITIONS = {
  DRAFT:    ['SENT'],
  SENT:     ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: ['DRAFT'],
}

// PATCH /api/quotations/[id]/status
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.quotations.update')
    if (denied) return denied

    await connectDB()

    const { status } = await request.json()
    const q = await Quotation.findById(params.id)
    if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const allowed = TRANSITIONS[q.status] ?? []
    if (!allowed.includes(status))
      return NextResponse.json({ error: `Cannot transition from ${q.status} to ${status}` }, { status: 409 })

    q.status = status
    if (status === 'SENT'     && !q.sentAt)     q.sentAt     = new Date()
    if (status === 'ACCEPTED' && !q.acceptedAt) q.acceptedAt = new Date()
    if (status === 'REJECTED' && !q.rejectedAt) q.rejectedAt = new Date()
    if (status === 'DRAFT')                     { q.sentAt = null; q.acceptedAt = null; q.rejectedAt = null }
    await q.save()

    // When a lead-sourced quotation is sent, advance the lead to PROPOSAL_SENT.
    // Only advance from earlier stages so we never regress a lead already in
    // NEGOTIATION / WON / LOST.
    if (status === 'SENT' && q.sourceType === 'LEAD' && q.leadId) {
      const lead = await Lead.findById(q.leadId)
      if (lead && ['NEW', 'CONTACTED'].includes(lead.status)) {
        const before = lead.status
        lead.status = 'PROPOSAL_SENT'
        await lead.save()

        await new LeadActivity({
          leadId:        lead._id,
          type:          'update',
          note:          `Status: ${before} → PROPOSAL_SENT (quotation ${q.quotationNumber} sent)`,
          createdById:   session.user.id,
          createdByName: session.user.name ?? session.user.email ?? 'Unknown',
        }).save()

        logActivity({
          userId:   session.user.id,
          userRole: session.user.role,
          action:   'STATUS_CHANGE',
          entity:   'LEAD',
          entityId: lead._id.toString(),
          changes:  `Status: ${before} → PROPOSAL_SENT (quotation ${q.quotationNumber} sent)`,
          request,
        })
      }
    }

    // Notify creator if changed by someone else
    if (q.createdBy && q.createdBy.toString() !== session.user.id) {
      const msgs = {
        SENT:     `Quotation ${q.quotationNumber} has been sent.`,
        ACCEPTED: `Quotation ${q.quotationNumber} was accepted!`,
        REJECTED: `Quotation ${q.quotationNumber} was rejected.`,
        DRAFT:    `Quotation ${q.quotationNumber} was reverted to draft.`,
      }
      await createNotification({
        userId:  q.createdBy.toString(),
        title:   `Quotation ${status.toLowerCase()}`,
        message: msgs[status] ?? `Quotation ${q.quotationNumber} status changed to ${status}.`,
        type:    'QUOTATION',
        link:    `/admin/quotations/${q._id}`,
      })
    }

    return NextResponse.json({ data: q.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/quotations/[id]/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
