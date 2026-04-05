export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Purchase } from '@/models'
import { z } from 'zod'

const schema = z.object({
  item:        z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  quantity:    z.number().min(0).optional(),
  unitPrice:   z.number().min(0).optional(),
  totalAmount: z.number().min(0).optional(),
  date:        z.string().optional(),
  category:    z.string().optional().nullable(),
  status:      z.enum(['pending', 'received', 'cancelled']).optional(),
  invoiceRef:  z.string().optional().nullable(),
  notes:       z.string().optional().nullable(),
})

// PUT /api/purchases/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body   = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const update = { ...parsed.data }
    if (update.date) update.date = new Date(update.date)

    const purchase = await Purchase.findByIdAndUpdate(params.id, update, { new: true })
    if (!purchase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: purchase })
  } catch (err) {
    console.error('[PUT /api/purchases/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/purchases/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    await Purchase.findByIdAndDelete(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/purchases/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
