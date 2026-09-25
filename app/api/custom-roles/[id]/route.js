export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CustomRole, Employee, EmployeeOnboarding } from '@/models'
import { canDo } from '@/lib/rbac'
import { ALL_PERMISSIONS } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// Delegated role managers (non-SUPER_ADMIN) may not edit the role they hold
// themselves, and may not add permissions they do not hold. Returns a 403
// NextResponse, or null to proceed.
async function checkEscalation(session, role, nextPermissions) {
  if (session.user.role === 'SUPER_ADMIN') return null
  const me = await Employee.findOne({ userId: session.user.id }).select('customRoleId').lean()
  if (me?.customRoleId && String(me.customRoleId) === String(role._id)) {
    return NextResponse.json({ error: 'You cannot edit the role assigned to you' }, { status: 403 })
  }
  const current = new Set(Array.isArray(role.permissions) ? role.permissions : [])
  const notHeld = nextPermissions.filter(p => !current.has(p) && !canDo(session, p))
  if (notHeld.length) {
    return NextResponse.json({ error: `You cannot grant permissions you do not hold: ${notHeld.join(', ')}` }, { status: 403 })
  }
  return null
}

// PUT — update role metadata (department, title, etc.)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDo(session, 'hr.roles.manage'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const { department, title, description, venture, color, isActive, permissions } = await request.json()
    if (!department?.trim() || !title?.trim())
      return NextResponse.json({ error: 'Department and title are required' }, { status: 422 })

    const existing = await CustomRole.findById(params.id).select('permissions').lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Same sanitising as PATCH: only known permission strings are stored.
    const validPerms = permissions !== undefined
      ? (Array.isArray(permissions) ? permissions.filter(p => ALL_PERMISSIONS.includes(p)) : [])
      : undefined
    const denied = await checkEscalation(session, existing, validPerms ?? [])
    if (denied) return denied

    const update = {
      department:  department.trim(),
      title:       title.trim(),
      description: description || null,
      venture:     venture || null,
      color:       color || '#6366f1',
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
      ...(validPerms !== undefined ? { permissions: validPerms } : {}),
    }

    const role = await CustomRole.findByIdAndUpdate(params.id, update, { new: true, runValidators: true })
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: role.toJSON() })
  } catch (err) {
    console.error('[PUT /api/custom-roles/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — update permissions array only
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDo(session, 'hr.roles.manage'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const { permissions } = await request.json()
    if (!Array.isArray(permissions))
      return NextResponse.json({ error: 'permissions must be an array of strings' }, { status: 422 })

    // Strip any unknown permission strings for safety
    const valid = permissions.filter(p => ALL_PERMISSIONS.includes(p))

    const existing = await CustomRole.findById(params.id).select('permissions').lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const denied = await checkEscalation(session, existing, valid)
    if (denied) return denied

    const role = await CustomRole.findByIdAndUpdate(
      params.id,
      { permissions: valid },
      { new: true, runValidators: false }
    )
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: role.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/custom-roles/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — only SUPER_ADMIN or users with hr.roles.manage
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDo(session, 'hr.roles.manage'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()
    // Deleting an assigned role would silently drop its holders back to the
    // (usually broader) base-role defaults — refuse until it is unassigned.
    const [assigned, pending] = await Promise.all([
      Employee.exists({ customRoleId: params.id }),
      EmployeeOnboarding.exists({ 'hrData.customRoleId': params.id, status: { $in: ['PENDING_SUBMISSION', 'SUBMITTED'] } }),
    ])
    if (assigned || pending)
      return NextResponse.json({ error: 'This role is still assigned to employees (or pending onboardings). Reassign them before deleting it.' }, { status: 409 })
    const role = await CustomRole.findByIdAndDelete(params.id)
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/custom-roles/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
