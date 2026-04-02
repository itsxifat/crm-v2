export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding, Employee } from '@/models'
import { generateEmployeeId } from '@/models/Employee'

// POST /api/onboarding/[token]/approve — HR saves employment details on the existing employee
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const record = await EmployeeOnboarding.findOne({ token: params.token })
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!record.employeeId)
      return NextResponse.json({ error: 'No employee account linked to this record' }, { status: 409 })

    const body = await request.json()
    const {
      venture, department, position, designation, salary, hireDate,
      customRoleId, appointmentLetterUrl, agreementUrl,
      companyPhone, companyWebmail, companyItems, hrNote,
    } = body

    // Auto-generate employeeId if department + hireDate + phone are now available
    const employee = await Employee.findById(record.employeeId)
    if (!employee) return NextResponse.json({ error: 'Employee record not found' }, { status: 404 })

    let newEmployeeId = employee.employeeId
    if (!newEmployeeId && department) {
      try {
        newEmployeeId = await generateEmployeeId({
          department,
          hireDate: hireDate ? new Date(hireDate) : (employee.hireDate ?? null),
        })
      } catch (err) {
        console.warn('[approve] employeeId generation skipped:', err.message)
      }
    }

    // Update the already-created Employee record with employment details
    await Employee.findByIdAndUpdate(record.employeeId, {
      venture:              venture              || null,
      department:           department           || null,
      position:             position             || null,
      designation:          designation          || null,
      salary:               salary               ?? null,
      hireDate:             hireDate             ? new Date(hireDate) : null,
      customRoleId:         customRoleId         || null,
      appointmentLetterUrl: appointmentLetterUrl || null,
      agreementUrl:         agreementUrl         || null,
      companyPhone:         companyPhone         || null,
      companyWebmail:       companyWebmail       || null,
      companyItems:         Array.isArray(companyItems) ? companyItems : [],
      ...(newEmployeeId && !employee.employeeId ? { employeeId: newEmployeeId } : {}),
    })

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
