export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer } from '@/models'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

async function resolveFreelancer(id, session) {
  const freelancer = await Freelancer.findById(id).populate({ path: 'userId', select: 'id name email' })
  if (!freelancer) return { error: 'Freelancer not found', status: 404 }

  const isStaff      = STAFF_ROLES.includes(session.user.role)
  const isOwnProfile = freelancer.userId?._id.toString() === session.user.id

  if (!isStaff && !isOwnProfile) {
    return { error: 'Forbidden', status: 403 }
  }

  return { freelancer, isStaff }
}

// GET /api/freelancers/[id]/payment
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { id } = await params
    const result = await resolveFreelancer(id, session)
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status })

    const { freelancer } = result
    return NextResponse.json({ data: freelancer.paymentMethod })
  } catch (err) {
    console.error('[GET /api/freelancers/[id]/payment]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/freelancers/[id]/payment
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { id } = await params
    const result = await resolveFreelancer(id, session)
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status })

    const { freelancer } = result
    const body = await request.json()
    const { method, bank, bkash } = body

    if (!method || !['BANK', 'BKASH'].includes(method)) {
      return NextResponse.json({ error: 'method must be BANK or BKASH' }, { status: 422 })
    }

    if (method === 'BANK') {
      if (!bank?.bankName || !bank?.accountNumber || !bank?.accountName) {
        return NextResponse.json({ error: 'bankName, accountNumber and accountName are required for BANK method' }, { status: 422 })
      }
      freelancer.paymentMethod = {
        method: 'BANK',
        bank: {
          bankName:      bank.bankName      ?? null,
          accountNumber: bank.accountNumber ?? null,
          accountName:   bank.accountName   ?? null,
          routingNumber: bank.routingNumber ?? null,
          swiftCode:     bank.swiftCode     ?? null,
          branch:        bank.branch        ?? null,
          division:      bank.division      ?? null,
        },
        bkash: freelancer.paymentMethod?.bkash ?? {},
      }
    } else if (method === 'BKASH') {
      if (!bkash?.accountNumber) {
        return NextResponse.json({ error: 'accountNumber is required for BKASH method' }, { status: 422 })
      }
      const validTypes = ['Personal', 'Agent', 'Merchant']
      freelancer.paymentMethod = {
        method: 'BKASH',
        bank: freelancer.paymentMethod?.bank ?? {},
        bkash: {
          accountType:   validTypes.includes(bkash.accountType) ? bkash.accountType : 'Personal',
          accountName:   bkash.accountName   ?? null,
          accountNumber: bkash.accountNumber ?? null,
        },
      }
    }

    await freelancer.save()
    return NextResponse.json({ data: freelancer.paymentMethod })
  } catch (err) {
    console.error('[PATCH /api/freelancers/[id]/payment]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
