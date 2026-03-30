export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee, Task, Leave, CustomRole } from '@/models'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

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
  emergencyContact:     z.string().optional().nullable(),
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
    const page       = parseInt(searchParams.get('page')       ?? '1',  10)
    const limit      = parseInt(searchParams.get('limit')      ?? '20', 10)
    const search     = searchParams.get('search')
    const department = searchParams.get('department')
    const skip       = (page - 1) * limit

    const filter = {}
    if (department) filter.department = department

    if (search) {
      const matchingUsers = await User.find({
        $or: [
          { name:  { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ],
      }).select('_id').lean()
      const userIds = matchingUsers.map(u => u._id)
      filter.$or = [
        { userId:     { $in: userIds } },
        { position:   { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ]
    }

    const [employees, total] = await Promise.all([
      Employee.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
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
            bloodGroup, emergencyContact, address, nidNumber, appointmentLetterUrl, agreementUrl, panelAccessGranted,
            customRoleId } = parsed.data

    const existing = await User.findOne({ email }).lean()
    if (existing) return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 })

    const rawPw    = password ?? Math.random().toString(36).slice(-8) + 'A1!'
    const hashedPw = await bcrypt.hash(rawPw, 12)

    const user     = await new User({ email, password: hashedPw, name, role: role ?? 'EMPLOYEE', phone, isActive: true }).save()
    const employee = await new Employee({
      userId: user._id, venture, department, position, designation, salary,
      hireDate: hireDate ? new Date(hireDate) : null, employeeId,
      bloodGroup, emergencyContact, address, nidNumber,
      appointmentLetterUrl, agreementUrl,
      panelAccessGranted: panelAccessGranted ?? false,
      customRoleId: customRoleId || null,
    }).save()
    await employee.populate([
      { path: 'userId', select: 'id name email avatar' },
      { path: 'customRoleId', select: 'id title department color' },
    ])

    return NextResponse.json({ data: employee, tempPassword: password ? undefined : rawPw }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/employees]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
