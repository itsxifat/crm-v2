export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, Employee } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { HELD_STATUSES } from '@/lib/inventory/constants'
import { handoverResponse, loadAssignEvents } from '@/app/api/my-assets/_lib/handover'

const VIEW_PERMS = ['hr.employees.view', 'inventory.view']

// GET /api/employees/[id]/assets/handover — printable handover & acknowledgement
// form listing everything currently issued to the employee (for signature at
// joining, on re-issue, or at exit clearance).
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const employee = await Employee.findById(params.id)
      .select('employeeId department designation position userId')
      .populate({ path: 'userId', select: 'name' })
      .lean()
    if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const assets = await Asset.find({ assignedEmployeeId: employee._id, status: { $in: HELD_STATUSES }, isArchived: { $ne: true } })
      .populate({ path: 'categoryId', select: 'name code' })
      .sort({ assignedAt: 1, assetTag: 1 })
      .lean()
    if (!assets.length) return NextResponse.json({ error: 'No equipment is currently issued to this employee' }, { status: 404 })

    const assignEvents = await loadAssignEvents(assets)
    return handoverResponse({
      request,
      employee: {
        name:        employee.userId?.name ?? null,
        employeeId:  employee.employeeId ?? null,
        designation: employee.designation ?? employee.position ?? null,
        department:  employee.department ?? null,
      },
      assets,
      assignEvents,
      printedBy: session.user.name ?? null,
    })
  } catch (err) {
    console.error('[GET /api/employees/[id]/assets/handover]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
