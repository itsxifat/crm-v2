export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Quotation } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { QUOTATION_POPULATE, quotationJSON } from '../../_lib/server'

// Today's calendar date in the business timezone, stored as UTC midnight —
// the same shape a YYYY-MM-DD date input produces.
function businessToday() {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
  return new Date(`${ymd}T00:00:00.000Z`)
}

// POST /api/quotations/[id]/duplicate → 201 { data: new DRAFT quotation }
// Copies lines, MFS charge, discount and the VAT setup (treatment, rates, service code) as they are.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    // The source document is read and returned, and a new one is created
    const denied = requirePerm(session, 'sales.quotations.view') || requirePerm(session, 'sales.quotations.create')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const original = await Quotation.findById(params.id).lean()
    if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { _id, quotationNumber, createdAt, updatedAt, sentAt, acceptedAt, rejectedAt, ...rest } = original

    const copy = await new Quotation({
      ...rest,
      status:           'DRAFT',
      issueDate:        businessToday(),
      validUntil:       null,
      createdBy:        session.user.id,
      duplicatedFromId: _id,
    }).save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'QUOTATION',
      entityId: copy._id.toString(),
      changes:  JSON.stringify({
        quotationNumber: copy.quotationNumber, duplicatedFrom: quotationNumber ?? null,
        total: copy.total, currency: copy.currency, vatTreatment: copy.vatTreatment,
      }),
      request,
    })

    await copy.populate(QUOTATION_POPULATE)
    return NextResponse.json({ data: quotationJSON(session, copy) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/quotations/[id]/duplicate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
