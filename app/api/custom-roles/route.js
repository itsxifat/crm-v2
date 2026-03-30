export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CustomRole } from '@/models'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()
    const roles = await CustomRole.find().sort({ department: 1, title: 1 }).populate('createdBy', 'name')
    return NextResponse.json({ data: roles.map(r => r.toJSON()) })
  } catch (err) {
    console.error('[GET /api/custom-roles]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { department, title, description, venture, color } = await request.json()
    if (!department?.trim() || !title?.trim())
      return NextResponse.json({ error: 'Department and title are required' }, { status: 422 })

    const role = await new CustomRole({
      department: department.trim(),
      title:      title.trim(),
      description: description || null,
      venture:    venture || null,
      color:      color || null,
      createdBy:  session.user.id,
    }).save()

    return NextResponse.json({ data: role.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/custom-roles]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
