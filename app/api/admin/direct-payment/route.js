export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import {
  Freelancer,
  FreelancerAssignment,
  WithdrawalRequest,
  Transaction,
  ProjectExpense,
  Project,
} from '@/models'
import { z } from 'zod'

const schema = z.object({
  freelancerId:  z.string().min(1),
  amount:        z.number().positive(),
  method:        z.string().min(1),
  reference:     z.string().optional().default(''),
  note:          z.string().optional().default(''),
  projectId:     z.string().optional().nullable(),
  assignmentId:  z.string().optional().nullable(),
})

// POST /api/admin/direct-payment
// Admin pays a freelancer directly — no withdrawal request needed.
// Records a WithdrawalRequest (status=PAID, isDirectPayment=true), a Transaction,
// a ProjectExpense (if project), and marks the assignment as PAID (if assignment).
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await req.json()
    const parsed = schema.safeParse({ ...body, amount: Number(body.amount) })
    if (!parsed.success) {
      return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { freelancerId, amount, method, reference, note, projectId, assignmentId } = parsed.data

    const freelancer = await Freelancer.findById(freelancerId).lean()
    if (!freelancer) return Response.json({ error: 'Freelancer not found' }, { status: 404 })

    let project = null
    if (projectId) {
      project = await Project.findById(projectId).select('name projectCode venture').lean()
    }

    // 1. Create a WithdrawalRequest that is already PAID (direct, no pending stage)
    const withdrawal = await new WithdrawalRequest({
      freelancerId,
      amount,
      method,
      details:         reference || null,
      status:          'PAID',
      projectId:       projectId  || null,
      assignmentId:    assignmentId || null,
      adminNote:       note || null,
      processedBy:     session.user.id,
      processedAt:     new Date(),
      isDirectPayment: true,
    }).save()

    // 2. Create a Transaction (EXPENSE – Freelancer Payment)
    const txn = await new Transaction({
      type:          'EXPENSE',
      category:      'Freelancer Payment',
      amount,
      description:   `Direct payment to freelancer${project ? ` for ${project.name}` : ''}${note ? ` — ${note}` : ''}`,
      date:          new Date(),
      reference:     reference || null,
      projectId:     projectId  || null,
      freelancerId:  freelancerId,
      paymentMethod: mapMethod(method),
      paidBy:        session.user.id,
      createdBy:     session.user.id,
    }).save()

    // 3. Link transaction back to withdrawal
    withdrawal.transactionId = txn._id
    await withdrawal.save()

    // 4. Create ProjectExpense (already APPROVED) if project is linked
    if (projectId && project) {
      await new ProjectExpense({
        projectId,
        venture:     project.venture ?? null,
        title:       `Freelancer payment${note ? `: ${note}` : ''}`,
        amount,
        category:    'Freelancer Payment',
        date:        new Date(),
        notes:       note || null,
        freelancerId,
        submittedBy: session.user.id,
        status:      'APPROVED',
        reviewedBy:  session.user.id,
        reviewedAt:  new Date(),
        syncedToAccounts:      true,
        accountsTransactionId: txn._id,
      }).save()
    }

    // 5. Mark assignment as PAID if linked
    if (assignmentId) {
      await FreelancerAssignment.findByIdAndUpdate(assignmentId, {
        paymentStatus:       'PAID',
        withdrawalRequestId: withdrawal._id,
      })
    }

    return Response.json({ data: { withdrawal, transaction: txn } }, { status: 201 })
  } catch (err) {
    console.error('[admin/direct-payment POST]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Map UI method strings to Transaction paymentMethod enum
function mapMethod(method) {
  const MAP = {
    BKASH:         'ONLINE',
    BANK:          'BANK_TRANSFER',
    BANK_TRANSFER: 'BANK_TRANSFER',
    CASH:          'CASH',
    CARD:          'CARD',
    CHEQUE:        'CHEQUE',
    PAYPAL:        'ONLINE',
    ONLINE:        'ONLINE',
  }
  return MAP[method?.toUpperCase()] ?? 'OTHER'
}
