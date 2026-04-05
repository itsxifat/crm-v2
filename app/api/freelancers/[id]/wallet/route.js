export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, Earning, WithdrawalRequest } from '@/models'
import { z } from 'zod'

const walletActionSchema = z.object({
  type:        z.enum(['credit', 'debit']),
  amount:      z.number().positive(),
  description: z.string().min(1),
})

// GET /api/freelancers/[id]/wallet
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const freelancer = await Freelancer.findById(params.id).select('id walletBalance').lean()
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [earnings, withdrawals] = await Promise.all([
      Earning.find({ freelancerId: params.id }).sort({ createdAt: -1 }).lean(),
      WithdrawalRequest.find({ freelancerId: params.id, status: { $in: ['APPROVED', 'PAID'] } }).sort({ createdAt: -1 }).lean(),
    ])

    const transactions = [
      ...earnings.map(e => ({
        id: e._id.toString(), type: 'credit', amount: e.amount,
        description: e.description, date: e.createdAt, category: e.type,
      })),
      ...withdrawals.map(w => w.isDirectPayment
        ? {
            id: w._id.toString(), type: 'direct_payment', amount: w.amount,
            description: `Direct payment via ${w.method}${w.adminNote ? ` — ${w.adminNote}` : ''}`,
            date: w.processedAt ?? w.createdAt, category: 'direct_payment',
          }
        : {
            id: w._id.toString(), type: 'debit', amount: w.amount,
            description: `Withdrawal via ${w.method}`, date: w.processedAt ?? w.createdAt, category: 'withdrawal',
          }
      ),
    ].sort((a, b) => new Date(b.date) - new Date(a.date))

    return NextResponse.json({ data: { balance: freelancer.walletBalance, transactions } })
  } catch (err) {
    console.error('[GET /api/freelancers/[id]/wallet]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/freelancers/[id]/wallet — admin credit/debit
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = walletActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { type, amount, description } = parsed.data

    const freelancer = await Freelancer.findById(params.id).lean()
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (type === 'debit' && freelancer.walletBalance < amount) {
      return NextResponse.json({ error: 'Insufficient wallet balance' }, { status: 400 })
    }

    const newBalance = type === 'credit'
      ? freelancer.walletBalance + amount
      : freelancer.walletBalance - amount

    const [earning, updated] = await Promise.all([
      new Earning({
        freelancerId: params.id,
        amount:       type === 'credit' ? amount : -amount,
        type:         type === 'credit' ? 'admin_credit' : 'admin_debit',
        description,
        approvedBy:   session.user.id,
      }).save(),
      Freelancer.findByIdAndUpdate(params.id, { walletBalance: newBalance }, { new: true }).select('id walletBalance'),
    ])

    return NextResponse.json({ data: { earning, walletBalance: updated.walletBalance } })
  } catch (err) {
    console.error('[POST /api/freelancers/[id]/wallet]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
