export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { HELD_STATUSES } from '@/lib/inventory/constants'
import { employeeForSession } from '../_lib/shared'
import { handoverResponse, loadAssignEvents } from '../_lib/handover'

// GET /api/my-assets/handover — printable handover & acknowledgement form for
// every item currently issued to the signed-in employee.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    await connectDB()

    const emp = await employeeForSession(session)
    if (!emp) return NextResponse.json({ error: 'Your account is not linked to an employee profile' }, { status: 403 })

    const assets = await Asset.find({ assignedEmployeeId: emp._id, status: { $in: HELD_STATUSES }, isArchived: { $ne: true } })
      .populate({ path: 'categoryId', select: 'name code' })
      .sort({ assignedAt: 1, assetTag: 1 })
      .lean()
    if (!assets.length) return NextResponse.json({ error: 'No equipment is currently issued to you' }, { status: 404 })

    const assignEvents = await loadAssignEvents(assets)
    return handoverResponse({
      request,
      employee: {
        name:        session.user.name ?? null,
        employeeId:  emp.employeeId ?? null,
        designation: emp.designation ?? emp.position ?? null,
        department:  emp.department ?? null,
      },
      assets,
      assignEvents,
      printedBy: session.user.name ?? null,
    })
  } catch (err) {
    console.error('[GET /api/my-assets/handover]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
