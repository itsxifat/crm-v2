import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CustomRole } from '@/models'

export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { department, title, description, venture, color, isActive, permissions } = await request.json()
    if (!department?.trim() || !title?.trim())
      return NextResponse.json({ error: 'Department and title are required' }, { status: 422 })

    const update = {
      department: department.trim(),
      title: title.trim(),
      description: description || null,
      venture: venture || null,
      color: color || '#6366f1',
      ...(isActive !== undefined ? { isActive } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
    }

    const role = await CustomRole.findByIdAndUpdate(params.id, update, { new: true, runValidators: true })
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: role.toJSON() })
  } catch (err) {
    console.error('[PUT /api/custom-roles/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — update permissions only
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { permissions } = await request.json()
    const role = await CustomRole.findByIdAndUpdate(
      params.id,
      { permissions },
      { new: true, runValidators: false }
    )
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: role.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/custom-roles/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()
    const role = await CustomRole.findByIdAndDelete(params.id)
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
