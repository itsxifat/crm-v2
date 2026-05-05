export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Timesheet, Employee, Freelancer } from '@/models'
import { z } from 'zod'

const timesheetSchema = z.object({
  hours:       z.number().positive(),
  description: z.string().optional().nullable(),
  date:        z.string(),
})

// GET /api/tasks/[id]/timesheets
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const timesheets = await Timesheet.find({ taskId: params.id })
      .sort({ date: -1 })
      .populate({ path: 'employeeId',   populate: { path: 'userId', select: 'id name avatar' } })
      .populate({ path: 'freelancerId', populate: { path: 'userId', select: 'id name avatar' } })

    const totalHours = timesheets.reduce((sum, t) => sum + t.hours, 0)
    return NextResponse.json({ data: timesheets, totalHours })
  } catch (err) {
    console.error('[GET /api/tasks/[id]/timesheets]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/tasks/[id]/timesheets
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body   = await request.json()
    const parsed = timesheetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const [employee, freelancer] = await Promise.all([
      Employee.findOne({ userId: session.user.id }).lean(),
      Freelancer.findOne({ userId: session.user.id }).lean(),
    ])

    const tsData = {
      ...parsed.data,
      taskId: params.id,
      date:   new Date(parsed.data.date),
    }
    if (employee)   tsData.employeeId   = employee._id
    if (freelancer) tsData.freelancerId = freelancer._id

    const timesheet = await new Timesheet(tsData).save()
    await timesheet.populate([
      { path: 'employeeId',   populate: { path: 'userId', select: 'id name avatar' } },
      { path: 'freelancerId', populate: { path: 'userId', select: 'id name avatar' } },
    ])

    // Update task actualHours
    const allTimesheets = await Timesheet.find({ taskId: params.id }).select('hours').lean()
    const totalHours = allTimesheets.reduce((sum, t) => sum + t.hours, 0)
    await Task.findByIdAndUpdate(params.id, { actualHours: totalHours })

    return NextResponse.json({ data: timesheet }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/tasks/[id]/timesheets]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
