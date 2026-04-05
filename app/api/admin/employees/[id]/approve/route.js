export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee } from '@/models'
import { sendEmployeeApprovedEmail } from '@/lib/mailer'

// POST /api/admin/employees/[id]/approve
// body: { action: 'approve' | 'reject', notes?: string }
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const hrRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!hrRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden — HR access only' }, { status: 403 })
    }

    await connectDB()

    const emp = await Employee.findById(params.id)
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const { action, notes } = await request.json()

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 422 })
    }

    if (action === 'approve') {
      if (emp.profileCompletionPct < 100) {
        return NextResponse.json({ error: 'Profile must be 100% complete before approval' }, { status: 422 })
      }
      emp.profileStatus      = 'APPROVED'
      emp.finalApproved      = true
      emp.kycApproved        = true
      emp.panelAccessGranted = true
      emp.panelAccessDate    = new Date()
      if (notes) emp.hrNotes = notes
    } else {
      // reject: send back to INCOMPLETE so employee can fix and resubmit
      emp.profileStatus = 'INCOMPLETE'
      emp.hrNotes       = notes ?? null
    }

    await emp.save()

    // Notify employee
    const user = await User.findById(emp.userId).select('name email').lean()
    if (user && action === 'approve') {
      sendEmployeeApprovedEmail({ to: user.email, name: user.name }).catch(err =>
        console.error('[approve] email failed:', err.message)
      )
    }

    return NextResponse.json({
      data: emp,
      message: action === 'approve' ? 'Employee approved and access granted' : 'Profile returned to employee for revision',
    })
  } catch (err) {
    console.error('[POST /api/admin/employees/[id]/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
