export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer } from '@/models'
import { sendFreelancerApprovedEmail } from '@/lib/mailer'
import { sendFreelancerApprovedWhatsApp } from '@/lib/whatsapp'

// POST /api/admin/freelancers/[id]/approve
// body: { action: 'approve' | 'reject', notes?: string }
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const hrRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!hrRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden — admin access only' }, { status: 403 })
    }

    await connectDB()

    const fl = await Freelancer.findById(params.id)
    if (!fl) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

    const { action, notes } = await request.json()
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 422 })
    }

    if (action === 'approve') {
      if ((fl.profileCompletionPct ?? 0) < 100) {
        return NextResponse.json({ error: 'KYC must be 100% complete before approval' }, { status: 422 })
      }
      fl.profileStatus = 'APPROVED'
      fl.kycApproved   = true
      fl.verifiedAt    = new Date()
      fl.verifiedBy    = session.user.id
      if (notes) fl.reviewNotes = notes
    } else {
      // reject: send back to INCOMPLETE so they can fix and resubmit
      fl.profileStatus = 'INCOMPLETE'
      fl.reviewNotes   = notes ?? null
    }

    await fl.save()

    // Notify the freelancer/agency
    const user = await User.findById(fl.userId).select('name email phone').lean()
    if (user && action === 'approve') {
      sendFreelancerApprovedEmail({ to: user.email, name: user.name }).catch(err =>
        console.error('[freelancer approve] email failed:', err.message)
      )
      if (user.phone) sendFreelancerApprovedWhatsApp({ to: user.phone, name: user.name })
    }

    return NextResponse.json({
      data: fl,
      message: action === 'approve' ? 'Freelancer verified and access granted' : 'KYC returned for revision',
    })
  } catch (err) {
    console.error('[POST /api/admin/freelancers/[id]/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
