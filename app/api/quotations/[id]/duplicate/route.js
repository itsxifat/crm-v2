export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation } from '@/models'

// POST /api/quotations/[id]/duplicate
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const original = await Quotation.findById(params.id).lean()
    if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { _id, quotationNumber, createdAt, updatedAt, sentAt, acceptedAt, rejectedAt, ...rest } = original

    const copy = await new Quotation({
      ...rest,
      status:           'DRAFT',
      issueDate:        new Date(),
      validUntil:       null,
      createdBy:        session.user.id,
      duplicatedFromId: _id,
    }).save()

    return NextResponse.json({ data: copy.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/quotations/[id]/duplicate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
