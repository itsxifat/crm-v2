export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding, Employee } from '@/models'
import { generateEmployeeId } from '@/models/Employee'
import { requirePerm, canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// POST /api/onboarding/[token]/approve — HR saves employment details on the existing employee
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.update')
    if (denied) return denied

    await connectDB()
    const record = await EmployeeOnboarding.findOne({ token: params.token })
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!record.employeeId)
      return NextResponse.json({ error: 'No employee account linked to this record' }, { status: 409 })
    if (record.status !== 'APPROVED')
      return NextResponse.json({ error: 'This onboarding record is not awaiting employment details' }, { status: 409 })

    const body = await request.json().catch(() => ({})) ?? {}
    const {
      venture, department, position, designation, salary, hireDate,
      customRoleId, appointmentLetterUrl, agreementUrl,
      companyPhone, companyWebmail, companyItems, hrNote,
    } = body

    if (salary !== undefined && salary !== null && (typeof salary !== 'number' || !Number.isFinite(salary) || salary < 0))
      return NextResponse.json({ error: 'Invalid salary' }, { status: 422 })
    if (hireDate && isNaN(new Date(hireDate).getTime()))
      return NextResponse.json({ error: 'Invalid hire date' }, { status: 422 })

    // A custom role replaces the whole permission set — that is role management.
    if (customRoleId) {
      if (!isValidObjectId(customRoleId))
        return NextResponse.json({ error: 'Invalid custom role' }, { status: 400 })
      if (!canDo(session, 'hr.roles.manage'))
        return NextResponse.json({ error: 'You do not have permission to assign custom roles' }, { status: 403 })
    }

    // Auto-generate employeeId if department + hireDate + phone are now available
    const employee = await Employee.findById(record.employeeId)
    if (!employee) return NextResponse.json({ error: 'Employee record not found' }, { status: 404 })
    if (String(employee.userId) === String(session.user.id))
      return NextResponse.json({ error: 'You cannot set your own employment details' }, { status: 403 })

    let newEmployeeId = employee.employeeId
    if (!newEmployeeId && department) {
      try {
        newEmployeeId = await generateEmployeeId({
          venture: venture ?? employee.venture,
          department,
          hireDate: hireDate ? new Date(hireDate) : (employee.hireDate ?? null),
        })
      } catch (err) {
        console.warn('[approve] employeeId generation skipped:', err.message)
      }
    }

    // Update the already-created Employee record with employment details
    // Only touch fields the request actually sent — omitted ones keep their value.
    const empUpdate = {}
    const str = (v) => (v == null || v === '' ? null : String(v))
    if (venture              !== undefined) empUpdate.venture              = str(venture)
    if (department           !== undefined) empUpdate.department           = str(department)
    if (position             !== undefined) empUpdate.position             = str(position)
    if (designation          !== undefined) empUpdate.designation          = str(designation)
    if (salary               !== undefined) empUpdate.salary               = salary ?? null
    if (hireDate             !== undefined) empUpdate.hireDate             = hireDate ? new Date(hireDate) : null
    if (customRoleId         !== undefined) empUpdate.customRoleId         = customRoleId || null
    if (appointmentLetterUrl !== undefined) empUpdate.appointmentLetterUrl = str(appointmentLetterUrl)
    if (agreementUrl         !== undefined) empUpdate.agreementUrl         = str(agreementUrl)
    if (companyPhone         !== undefined) empUpdate.companyPhone         = str(companyPhone)
    if (companyWebmail       !== undefined) empUpdate.companyWebmail       = str(companyWebmail)
    if (companyItems         !== undefined) empUpdate.companyItems         = Array.isArray(companyItems) ? companyItems : []
    if (newEmployeeId && !employee.employeeId) empUpdate.employeeId = newEmployeeId
    await Employee.findByIdAndUpdate(record.employeeId, empUpdate)

    if (hrNote !== undefined) record.hrNote = hrNote
    record.status = 'COMPLETED'
    record.hrData = {
      venture, department, position, designation,
      salary:    salary    ?? null,
      hireDate:  hireDate  ? new Date(hireDate) : null,
      customRoleId:         customRoleId         || null,
      appointmentLetterUrl: appointmentLetterUrl || null,
      agreementUrl:         agreementUrl         || null,
      companyPhone:         companyPhone         || null,
      companyWebmail:       companyWebmail       || null,
      companyItems:         Array.isArray(companyItems) ? companyItems : [],
    }
    await record.save()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[POST /api/onboarding/[token]/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
