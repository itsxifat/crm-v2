export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Agreement } from '@/models'
import { z } from 'zod'
import { agreementScopeFilter, AGREEMENT_POPULATE } from '@/lib/agreementAccess'
import { isValidObjectId } from '@/lib/objectId'

const optionalId = z.string().refine(isValidObjectId, 'Invalid id').optional().nullable()

// Whitelisted editable fields. createdBy, signatureUrl and version are not
// client-editable.
const updateSchema = z.object({
  title:        z.string().min(1).optional(),
  type:         z.string().min(1).optional(),
  content:      z.string().optional().nullable(),
  fileUrl:      z.string().optional().nullable(),
  status:       z.enum(['DRAFT','SENT','SIGNED','EXPIRED','CANCELLED']).optional(),
  expiryDate:   z.string().optional().nullable(),
  signedAt:     z.string().optional().nullable(),
  clientId:     optionalId,
  freelancerId: optionalId,
  vendorId:     optionalId,
  projectId:    optionalId,
}).strip()

// GET /api/agreements/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const scope = await agreementScopeFilter(session)
    if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const agreement = await Agreement.findOne({ ...scope, _id: params.id })
      .populate(AGREEMENT_POPULATE)

    if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: agreement })
  } catch (err) {
    console.error('[GET /api/agreements/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/agreements/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const { expiryDate, signedAt, ...rest } = parsed.data

    const agreement = await Agreement.findByIdAndUpdate(
      params.id,
      {
        ...rest,
        ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
        ...(signedAt   !== undefined && { signedAt:   signedAt   ? new Date(signedAt)   : null }),
      },
      { new: true, runValidators: true }
    )

    if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: agreement })
  } catch (err) {
    console.error('[PUT /api/agreements/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/agreements/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    await Agreement.findByIdAndDelete(params.id)
    return NextResponse.json({ message: 'Agreement deleted' })
  } catch (err) {
    console.error('[DELETE /api/agreements/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
