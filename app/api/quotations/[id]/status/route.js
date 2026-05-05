export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation } from '@/models'
import { createNotification } from '@/lib/createNotification'

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
