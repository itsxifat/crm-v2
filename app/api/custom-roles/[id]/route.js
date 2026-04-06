export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CustomRole } from '@/models'
import { canDo } from '@/lib/rbac'
import { ALL_PERMISSIONS } from '@/lib/rbac'

// PUT — update role metadata (department, title, etc.)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDo(session, 'hr.roles.manage'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { department, title, description, venture, color, isActive, permissions } = await request.json()
    if (!department?.trim() || !title?.trim())
      return NextResponse.json({ error: 'Department and title are required' }, { status: 422 })

    const update = {
      department:  department.trim(),
      title:       title.trim(),
      description: description || null,
      venture:     venture || null,
      color:       color || '#6366f1',
      ...(isActive !== undefined ? { isActive } : {}),
      ...(permissions !== undefined ? { permissions: Array.isArray(permissions) ? permissions : [] } : {}),
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
    await connectDB()

    const { permissions } = await request.json()
    if (!Array.isArray(permissions))
      return NextResponse.json({ error: 'permissions must be an array of strings' }, { status: 422 })

    // Strip any unknown permission strings for safety
    const valid = permissions.filter(p => ALL_PERMISSIONS.includes(p))

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
    await connectDB()
    const role = await CustomRole.findByIdAndDelete(params.id)
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/custom-roles/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
