export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, EMPLOYEE_PII } from '@/lib/pii'
import connectDB from '@/lib/mongodb'
import { User, Employee, Task, Leave, Attendance } from '@/models'
import { generateEmployeeId } from '@/models/Employee'
import { logActivity } from '@/lib/logActivity'
import { z } from 'zod'

const updateEmployeeSchema = z.object({
  name:                 z.string().min(1).optional(),
  email:                z.string().email().optional(),
  phone:                z.string().optional().nullable(),
  venture:              z.string().optional().nullable(),
  department:           z.string().optional().nullable(),
  position:             z.string().optional().nullable(),
  designation:          z.string().optional().nullable(),
  salary:               z.number().min(0).optional().nullable(),
  hireDate:             z.string().optional().nullable(),
  employeeId:           z.string().optional().nullable(),
  isActive:             z.boolean().optional(),
  role:                 z.enum(['SUPER_ADMIN','MANAGER','EMPLOYEE','FREELANCER','CLIENT','VENDOR']).optional(),
  bloodGroup:           z.string().optional().nullable(),
  emergencyContacts:    z.array(z.object({
    name:     z.string().min(1),
    relation: z.string().min(1),
    phone:    z.string().min(1),
  })).optional(),
  address:              z.string().optional().nullable(),
  nidNumber:            z.string().optional().nullable(),
  appointmentLetterUrl: z.string().optional().nullable(),
  agreementUrl:         z.string().optional().nullable(),
  panelAccessGranted:   z.boolean().optional(),
  customRoleId:         z.string().optional().nullable(),
  password:             z.string().min(6).optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  resign:               z.boolean().optional(),
})

// GET /api/employees/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.employees.view')
    if (denied) return denied

    await connectDB()

    const employee = await Employee.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive role createdAt lastLogin' })

    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const [tasks, attendance, leaves] = await Promise.all([
      Task.find({ assignedEmployeeId: params.id })
        .sort({ createdAt: -1 })
        .populate({ path: 'projectId', select: 'id name' }),
      Attendance.find({ employeeId: params.id }).sort({ date: -1 }).limit(30),
      Leave.find({ employeeId: params.id }).sort({ createdAt: -1 }),
    ])

    const completedTasks  = tasks.filter(t => t.status === 'COMPLETED').length
    const totalTasks      = tasks.length
    const completionRate  = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    return NextResponse.json({
      data: maskDoc(session, { ...employee.toJSON(), tasks, attendance, leaves, completedTasks, totalTasks, completionRate }, EMPLOYEE_PII),
    })
  } catch (err) {
    console.error('[GET /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/employees/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.update')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = updateEmployeeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { name, email, phone, isActive, role, password, hireDate, resign, ...empData } = parsed.data

    // Only a Super Admin may promote to MANAGER/SUPER_ADMIN — prevents a custom
    // role granted employee-edit from escalating privileges.
    if (role !== undefined && role !== 'EMPLOYEE' && session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Only a Super Admin can assign Manager or Super Admin roles' }, { status: 403 })
    }

    const current = await Employee.findById(params.id).lean()
    if (!current) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const userUpdate = {}

    // Resign action — deactivate panel and user account
    if (resign) {
      empData.resigned          = true
      empData.resignDate        = new Date()
      empData.panelAccessGranted = false
      userUpdate.isActive       = false
    }

    if (name     !== undefined) userUpdate.name     = name
    if (email    !== undefined) userUpdate.email    = email
    if (phone    !== undefined) { userUpdate.phone  = phone; empData.phone = phone }
    if (isActive !== undefined) userUpdate.isActive = isActive
    if (role     !== undefined) userUpdate.role     = role
    if (password) {
      const bcrypt = (await import('bcryptjs')).default
      userUpdate.password = await bcrypt.hash(password, 10)
    }

    // Auto-generate employeeId if not yet set and we now have a department
    if (!current.employeeId && !empData.employeeId) {
      const dept    = empData.department ?? current.department
      const hd      = hireDate ? new Date(hireDate) : current.hireDate
      const venture = empData.venture ?? current.venture
      if (dept) {
        try {
          empData.employeeId = await generateEmployeeId({ venture, department: dept, hireDate: hd })
        } catch (e) {
          console.warn('[PUT /api/employees] employeeId generation skipped:', e.message)
        }
      }
    }

    await Promise.all([
      Object.keys(userUpdate).length > 0 ? User.findByIdAndUpdate(current.userId, userUpdate) : Promise.resolve(),
      Employee.findByIdAndUpdate(params.id, { ...empData, ...(hireDate ? { hireDate: new Date(hireDate) } : {}) }),
    ])

    const updated = await Employee.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar isActive' })
      .populate({ path: 'customRoleId', select: 'id title department color' })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'EMPLOYEE',
      entityId: params.id,
      changes:  JSON.stringify({ name: updated?.userId?.name ?? null }),
      request,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PUT /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/employees/[id] — partial update (documents, photo, etc.)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.update')
    if (denied) return denied

    await connectDB()

    const body = await request.json()
    const allowed = ['documents', 'photo', 'appointmentLetterUrl', 'agreementUrl',
                     'companyPhone', 'companyWebmail', 'companyItems']
    const update = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    if (Object.keys(update).length === 0)
      return NextResponse.json({ error: 'Nothing to update' }, { status: 422 })

    const updated = await Employee.findByIdAndUpdate(params.id, update, { new: true })
      .populate({ path: 'userId', select: 'id name email avatar phone isActive role lastLogin' })

    if (!updated) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PATCH /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/employees/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.delete')
    if (denied) return denied

    await connectDB()

    const employee = await Employee.findById(params.id).lean()
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    await User.findByIdAndUpdate(employee.userId, { isActive: false })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'EMPLOYEE',
      entityId: params.id,
      changes:  JSON.stringify({ employeeId: employee.employeeId ?? null, deactivated: true }),
      request,
    })

    return NextResponse.json({ success: true, message: 'Employee deactivated' })
  } catch (err) {
    console.error('[DELETE /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
