export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee } from '@/models'
import { sendEmployeeApprovedEmail } from '@/lib/mailer'
import { sendEmployeeApprovedWhatsApp } from '@/lib/whatsapp'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, EMPLOYEE_PII } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'

// POST /api/admin/employees/[id]/approve
// body: { action: 'approve' | 'reject', notes?: string }
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    await connectDB()

    const emp = await Employee.findById(params.id)
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (String(emp.userId) === String(session.user.id) && session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'You cannot review your own profile' }, { status: 403 })

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
    const user = await User.findById(emp.userId).select('name email phone').lean()
    if (user && action === 'approve') {
      sendEmployeeApprovedEmail({ to: user.email, name: user.name }).catch(err =>
        console.error('[approve] email failed:', err.message)
      )
      if (user.phone) {
        sendEmployeeApprovedWhatsApp({ to: user.phone, name: user.name })
      }
    }

    return NextResponse.json({
      data: maskDoc(session, emp.toJSON(), EMPLOYEE_PII),
      message: action === 'approve' ? 'Employee approved and access granted' : 'Profile returned to employee for revision',
    })
  } catch (err) {
    console.error('[POST /api/admin/employees/[id]/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
