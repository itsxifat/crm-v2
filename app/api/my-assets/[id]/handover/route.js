export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, Employee } from '@/models'
import { requireStaff, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { employeeForSession } from '../../_lib/shared'
import { handoverResponse, loadAssignEvents } from '../../_lib/handover'

const STAFF_PERMS = ['inventory.view', 'inventory.assign', 'inventory.manage', 'hr.employees.view']

// GET /api/my-assets/[id]/handover — printable handover form for one asset.
// The current assignee may print their own; inventory / HR staff may print any
// assigned asset (for the employee to sign).
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const asset = await Asset.findById(params.id)
      .populate({ path: 'categoryId', select: 'name code' })
      .lean()
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const me = await employeeForSession(session)
    const isAssignee = Boolean(me && asset.assignedEmployeeId && String(asset.assignedEmployeeId) === String(me._id))
    if (!isAssignee && !canDoAny(session, STAFF_PERMS)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!asset.assignedEmployeeId) {
      return NextResponse.json({ error: 'This asset is not issued to an employee' }, { status: 409 })
    }

    const holder = isAssignee
      ? { ...me, userId: { name: session.user.name } }
      : await Employee.findById(asset.assignedEmployeeId)
        .select('employeeId department designation position userId')
        .populate({ path: 'userId', select: 'name' })
        .lean()

    const assignEvents = await loadAssignEvents([asset])
    return handoverResponse({
      request,
      employee: {
        name:        holder?.userId?.name ?? null,
        employeeId:  holder?.employeeId ?? null,
        designation: holder?.designation ?? holder?.position ?? null,
        department:  holder?.department ?? null,
      },
      assets: [asset],
      assignEvents,
      printedBy: session.user.name ?? null,
    })
  } catch (err) {
    console.error('[GET /api/my-assets/[id]/handover]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
