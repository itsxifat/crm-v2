export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer } from '@/models'
import { requireStaff, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { sendFreelancerApprovedEmail } from '@/lib/mailer'
import { sendFreelancerApprovedWhatsApp } from '@/lib/whatsapp'

// POST /api/admin/freelancers/[id]/approve
// body: { action: 'approve' | 'reject', notes?: string }
// Only a profile awaiting review (PENDING_APPROVAL) can be approved or rejected.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const notStaff = requireStaff(session)
    if (notStaff) return notStaff

    if (!isValidObjectId(params.id)) {
      return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })
    }

    await connectDB()

    const current = await Freelancer.findById(params.id).select('type profileStatus profileCompletionPct userId').lean()
    if (!current) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

    // Agencies are managed under hr.agencies.manage, freelancers under hr.freelancers.manage.
    const denied = requirePerm(session, current.type === 'AGENCY' ? 'hr.agencies.manage' : 'hr.freelancers.manage')
    if (denied) return denied

    const { action, notes } = await request.json()
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 422 })
    }
    const reviewNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null

    let update
    if (action === 'approve') {
      if ((current.profileCompletionPct ?? 0) < 100) {
        return NextResponse.json({ error: 'KYC must be 100% complete before approval' }, { status: 422 })
      }
      update = {
        profileStatus: 'APPROVED',
        kycApproved:   true,
        verifiedAt:    new Date(),
        verifiedBy:    session.user.id,
        ...(reviewNotes && { reviewNotes }),
      }
    } else {
      // reject: send back to INCOMPLETE so they can fix and resubmit
      update = {
        profileStatus: 'INCOMPLETE',
        kycApproved:   false,
        verifiedAt:    null,
        verifiedBy:    null,
        reviewNotes,
      }
    }

    // Conditional on the current status so a stale page (or a double click) can't
    // reject an already-approved profile or re-approve it.
    const fl = await Freelancer.findOneAndUpdate(
      { _id: params.id, profileStatus: 'PENDING_APPROVAL' },
      { $set: update },
      { new: true }
    ).select('profileStatus kycApproved verifiedAt reviewNotes').lean()

    if (!fl) {
      return NextResponse.json({ error: 'This profile is not awaiting review (it may already have been processed). Refresh the page.' }, { status: 409 })
    }

    // Notify the freelancer/agency
    const user = await User.findById(current.userId).select('name email phone').lean()
    if (user && action === 'approve') {
      sendFreelancerApprovedEmail({ to: user.email, name: user.name }).catch(err =>
        console.error('[freelancer approve] email failed:', err.message)
      )
      if (user.phone) sendFreelancerApprovedWhatsApp({ to: user.phone, name: user.name })
    }

    // Status fields only — never the full document (bank details, ID numbers, invite token).
    return NextResponse.json({
      data: {
        id:            String(fl._id),
        profileStatus: fl.profileStatus,
        kycApproved:   fl.kycApproved,
        verifiedAt:    fl.verifiedAt ?? null,
        reviewNotes:   fl.reviewNotes ?? null,
      },
      message: action === 'approve' ? 'Freelancer verified and access granted' : 'KYC returned for revision',
    })
  } catch (err) {
    console.error('[POST /api/admin/freelancers/[id]/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
