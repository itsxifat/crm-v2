export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee, Task, Leave, CustomRole } from '@/models'
import { normalizeDeptCode } from '@/models/Employee'
import { requirePerm, canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDayStart } from '@/lib/dhakaTime'
import { ciEquals, ciContains } from '@/lib/searchMatch'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { sendEmployeeLoginEmail } from '@/lib/mailer'
import { sendEmployeeLoginWhatsApp } from '@/lib/whatsapp'
import { logActivity } from '@/lib/logActivity'
import { maskList, EMPLOYEE_PII } from '@/lib/pii'

const createEmployeeSchema = z.object({
  name:                 z.string().min(1, 'Name is required'),
  email:                z.string().email('Valid email required'),
  password:             z.string().min(8).optional().nullable(),
  phone:                z.string().optional().nullable(),
  venture:              z.string().optional().nullable(),
  department:           z.string().optional().nullable(),
  position:             z.string().optional().nullable(),
  designation:          z.string().optional().nullable(),
  salary:               z.number().min(0).optional().nullable(),
  hireDate:             z.string().optional().nullable(),
  employeeId:           z.string().optional().nullable(),
  role:                 z.enum(['EMPLOYEE','MANAGER','SUPER_ADMIN']).default('EMPLOYEE'),
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
})

// GET /api/employees
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page       = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit      = parseInt(searchParams.get('limit') ?? '20', 10)
    const search     = searchParams.get('search')
    const department = searchParams.get('department')  // full name or 3-letter code
    const year       = searchParams.get('year')        // e.g. "2024"
    const sortBy     = searchParams.get('sortBy')      // "employeeId" | default createdAt
    const status     = searchParams.get('status')      // "active" | "resigned" | "all" (default: all)
    const skip       = (page - 1) * limit

    const filter = {}

    // Status filter (resigned is a plain boolean — DB filter is fine)
    if (status === 'active')   filter.resigned = { $ne: true }
    if (status === 'resigned') filter.resigned = true
    // Awaiting HR review — surfaces employees who submitted their profile.
    if (status === 'pending')  filter.profileStatus = 'PENDING_APPROVAL'

    // Year filter — match employeeId pattern [VENTURE_PREFIX]-[DEPT][YY][MM][SERIAL]
    // (employeeId is NOT encrypted, so regex works here)
    // Venture prefix comes from config (2-4 chars) and dept codes are 2-6 letters.
    if (year && /^\d{2,4}$/.test(String(year))) {
      const yy = String(year).slice(-2)
      filter.employeeId = { $regex: `^[A-Z0-9]{2,4}-[A-Z]{2,6}${yy}\\d{2}\\d{3,}$`, $options: 'i' }
    }

    if (search) {
      const matchingUsers = await User.find({
        $or: [{ name: ciContains(search) }, { email: ciContains(search) }, { phone: ciContains(search) }],
      }).select('_id').lean()
      const userIds = matchingUsers.map(u => u._id)
      filter.$or = [
        { userId:     { $in: userIds } },
        { employeeId: ciContains(search) },
      ]
    }

    // department is plaintext — accept a code (DEV) or full name (Development)
    if (department) {
      const code = normalizeDeptCode(department)
      filter.department = code ? ciEquals(code) : ciContains(department)
    }

    const sortOpt = sortBy === 'employeeId' ? { employeeId: 1 } : { createdAt: -1 }
    const popUser = { path: 'userId', select: 'id name email avatar phone isActive role' }
    const popRole = { path: 'customRoleId', select: 'id title department color' }

    const [employees, total] = await Promise.all([
      Employee.find(filter).skip(skip).limit(limit).sort(sortOpt).populate(popUser).populate(popRole),
      Employee.countDocuments(filter),
    ])

    const employeeIds = employees.map(e => e._id)
    const tasks = await Task.find({ assignedEmployeeId: { $in: employeeIds } }).select('assignedEmployeeId status').lean()

    const enriched = employees.map(e => {
      const eTasks = tasks.filter(t => t.assignedEmployeeId.toString() === e._id.toString())
      return {
        ...e.toJSON(),
        activeTaskCount: eTasks.filter(t => ['TODO','IN_PROGRESS','IN_REVIEW'].includes(t.status)).length,
      }
    })

    // Global stats
    // "Today" is the business (Asia/Dhaka) calendar day, not the server's.
    const today    = dhakaDayStart()
    const tomorrow = dhakaDayStart(new Date(), 1)

    const [totalEmployees, activeTasks, onLeaveToday, departments] = await Promise.all([
      Employee.countDocuments(),
      Task.countDocuments({ status: { $in: ['TODO','IN_PROGRESS'] }, assignedEmployeeId: { $ne: null } }),
      Leave.countDocuments({ status: 'APPROVED', startDate: { $lt: tomorrow }, endDate: { $gte: today } }),
      Employee.distinct('department', { department: { $ne: null } }),
    ])

    return NextResponse.json({
      data: maskList(session, enriched, EMPLOYEE_PII),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
      stats: { totalEmployees, activeTasks, onLeaveToday, departmentCount: departments.length, departments },
    })
  } catch (err) {
    console.error('[GET /api/employees]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/employees
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.create')
    if (denied) return denied

    // Assigning MANAGER or SUPER_ADMIN is reserved for a Super Admin (no
    // privilege escalation) — even for a custom role granted employee-create.
    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'

    await connectDB()

    const body   = await request.json()
    const parsed = createEmployeeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    // Managers may create employees, but only plain EMPLOYEEs — assigning MANAGER
    // or SUPER_ADMIN is reserved for a Super Admin (no privilege escalation).
    if (!isSuperAdmin && (parsed.data.role ?? 'EMPLOYEE') !== 'EMPLOYEE') {
      return NextResponse.json({ error: 'Only a Super Admin can assign Manager or Super Admin roles' }, { status: 403 })
    }

    const { name, email, password, phone, venture, department, position, designation, salary, hireDate, employeeId, role,
            bloodGroup, emergencyContacts, address, nidNumber, appointmentLetterUrl, agreementUrl, panelAccessGranted,
            customRoleId } = parsed.data

    // A custom role replaces the whole permission set — assigning one is role
    // management, not employee creation.
    if (customRoleId) {
      if (!isValidObjectId(customRoleId)) {
        return NextResponse.json({ error: 'Invalid custom role' }, { status: 400 })
      }
      if (!canDo(session, 'hr.roles.manage')) {
        return NextResponse.json({ error: 'You do not have permission to assign custom roles' }, { status: 403 })
      }
    }

    const existing = await User.findOne({ email: ciEquals(email) }).select('_id').lean()
    if (existing) return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 })

    const rawPw    = password ?? Math.random().toString(36).slice(-8) + 'A1!'
    const hashedPw = await bcrypt.hash(rawPw, 12)

    const user     = await new User({ email, password: hashedPw, name, role: role ?? 'EMPLOYEE', phone, isActive: true }).save()
    let employee
    try {
      // The auto-generated employeeId is max+1 (not atomic): retry on a
      // duplicate-key race. A caller-supplied duplicate ID is not retried.
      for (let attempt = 0; ; attempt++) {
        try {
          employee = await new Employee({
            userId: user._id, venture, department, position, designation, salary,
            hireDate: hireDate ? new Date(hireDate) : null, employeeId,
            bloodGroup, emergencyContacts, address, nidNumber,
            appointmentLetterUrl, agreementUrl,
            panelAccessGranted: panelAccessGranted ?? false,
            customRoleId: customRoleId || null,
          }).save()
          break
        } catch (e) {
          const dupId = e?.code === 11000 && (e.keyPattern?.employeeId || String(e.message).includes('employeeId'))
          if (dupId && !employeeId && attempt < 4) continue
          throw e
        }
      }
    } catch (e) {
      // Roll back the login so the admin can retry with the same email.
      await User.deleteOne({ _id: user._id }).catch(() => {})
      if (e?.code === 11000 && (e.keyPattern?.employeeId || String(e.message).includes('employeeId'))) {
        return NextResponse.json({ error: 'This employee ID is already in use' }, { status: 409 })
      }
      throw e
    }
    await employee.populate([
      { path: 'userId', select: 'id name email avatar' },
      { path: 'customRoleId', select: 'id title department color' },
    ])

    // Fire-and-forget login credentials email + WhatsApp
    sendEmployeeLoginEmail({ to: email, name, password: rawPw }).catch(err =>
      console.error('[POST /api/employees] login email failed:', err.message)
    )
    if (phone) {
      sendEmployeeLoginWhatsApp({ to: phone, email, name, password: rawPw }).catch(err =>
        console.error('[POST /api/employees] login WhatsApp failed:', err.message)
      )
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'EMPLOYEE',
      entityId: employee._id.toString(),
      changes:  JSON.stringify({ name, role: role ?? 'EMPLOYEE', department }),
      request,
    })

    return NextResponse.json({ data: employee, tempPassword: password ? undefined : rawPw }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/employees]', err)
    // Surface the real reason (admin-only route) so genuine failures aren't hidden
    // behind a generic message — e.g. a duplicate key or a cast error.
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
