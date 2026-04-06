export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee, Task, Leave, CustomRole } from '@/models'
import { normalizeDeptCode } from '@/models/Employee'
import { blindIndex } from '@/lib/encryption'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { sendEmployeeLoginEmail } from '@/lib/mailer'
import { sendEmployeeLoginWhatsApp } from '@/lib/whatsapp'

const createEmployeeSchema = z.object({
  name:                 z.string().min(1, 'Name is required'),
  email:                z.string().email('Valid email required'),
  password:             z.string().min(8).optional().nullable(),
  phone:                z.string().optional().nullable(),
  venture:              z.enum(['ENSTUDIO','ENTECH','ENMARK']).optional().nullable(),
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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

    // Status filter
    if (status === 'active')   filter.resigned = { $ne: true }
    if (status === 'resigned') filter.resigned = true

    // Department filter — accept both code (DEV) and full name (Development)
    if (department) {
      const code = normalizeDeptCode(department)
      filter.department = code
        ? { $regex: `^${code}$`, $options: 'i' }  // exact code match
        : { $regex: department, $options: 'i' }    // fallback: raw substring
    }

    // Year filter — match employeeId pattern [VENTURE_PREFIX]-[DEPT][YY][MM][SERIAL]
    if (year) {
      const yy = String(year).slice(-2)
      filter.employeeId = { $regex: `^EN[TM]?-[A-Z]{2,4}${yy}`, $options: 'i' }
    }

    if (search) {
      // name/email/phone are encrypted — search by blind index (exact match only) or employeeId
      const emailToken = blindIndex(search, 'users', 'email')
      const phoneToken = blindIndex(search, 'users', 'phone')
      const matchingUsers = await User.find({
        $or: [{ emailIdx: emailToken }, { phoneIdx: phoneToken }],
      }).select('_id').select('+emailIdx +phoneIdx').lean()
      const userIds = matchingUsers.map(u => u._id)
      filter.$or = [
        { userId:     { $in: userIds } },
        { employeeId: { $regex: search, $options: 'i' } },
      ]
    }

    const sortOpt = sortBy === 'employeeId' ? { employeeId: 1 } : { createdAt: -1 }

    const [employees, total] = await Promise.all([
      Employee.find(filter)
        .skip(skip)
        .limit(limit)
        .sort(sortOpt)
        .populate({ path: 'userId', select: 'id name email avatar phone isActive role' })
        .populate({ path: 'customRoleId', select: 'id title department color' }),
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
    const today    = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)

    const [totalEmployees, activeTasks, onLeaveToday, departments] = await Promise.all([
      Employee.countDocuments(),
      Task.countDocuments({ status: { $in: ['TODO','IN_PROGRESS'] }, assignedEmployeeId: { $ne: null } }),
      Leave.countDocuments({ status: 'APPROVED', startDate: { $lte: tomorrow }, endDate: { $gte: today } }),
      Employee.distinct('department', { department: { $ne: null } }),
    ])

    return NextResponse.json({
      data: enriched,
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = createEmployeeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { name, email, password, phone, venture, department, position, designation, salary, hireDate, employeeId, role,
            bloodGroup, emergencyContacts, address, nidNumber, appointmentLetterUrl, agreementUrl, panelAccessGranted,
            customRoleId } = parsed.data

    const emailToken = blindIndex(email, 'users', 'email')
    const existing = await User.findOne({ emailIdx: emailToken }).select('+emailIdx').lean()
    if (existing) return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 })

    const rawPw    = password ?? Math.random().toString(36).slice(-8) + 'A1!'
    const hashedPw = await bcrypt.hash(rawPw, 12)

    const user     = await new User({ email, password: hashedPw, name, role: role ?? 'EMPLOYEE', phone, isActive: true }).save()
    const employee = await new Employee({
      userId: user._id, venture, department, position, designation, salary,
      hireDate: hireDate ? new Date(hireDate) : null, employeeId,
      bloodGroup, emergencyContacts, address, nidNumber,
      appointmentLetterUrl, agreementUrl,
      panelAccessGranted: panelAccessGranted ?? false,
      customRoleId: customRoleId || null,
    }).save()
    await employee.populate([
      { path: 'userId', select: 'id name email avatar' },
      { path: 'customRoleId', select: 'id title department color' },
    ])

    // Fire-and-forget login credentials email + WhatsApp
    sendEmployeeLoginEmail({ to: email, name, password: rawPw }).catch(err =>
      console.error('[POST /api/employees] login email failed:', err.message)
    )
    if (phone) {
      sendEmployeeLoginWhatsApp({ to: phone, name, password: rawPw })
    }

    return NextResponse.json({ data: employee, tempPassword: password ? undefined : rawPw }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/employees]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
