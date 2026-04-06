export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Department } from '@/models'
import { generateShortCode } from '@/models/Department'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()
    const depts = await Department.find({ isActive: true }).sort({ name: 1 })
    return NextResponse.json({ data: depts.map(d => d.toJSON()) })
  } catch (err) {
    console.error('[GET /api/departments]', err)
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
    const { name, shortCode, description } = await request.json()
    if (!name?.trim()) return NextResponse.json({ error: 'Department name is required' }, { status: 400 })

    const code = (shortCode?.trim() || generateShortCode(name)).toUpperCase()

    // Check uniqueness
    const existing = await Department.findOne({ $or: [
      { name: { $regex: `^${name.trim()}$`, $options: 'i' } },
      { shortCode: code },
    ]})
    if (existing) {
      if (existing.name.toLowerCase() === name.trim().toLowerCase())
        return NextResponse.json({ error: 'A department with this name already exists' }, { status: 409 })
      return NextResponse.json({ error: `Short code "${code}" is already in use` }, { status: 409 })
    }

    const dept = await Department.create({
      name:        name.trim(),
      shortCode:   code,
      description: description?.trim() || null,
      createdBy:   session.user.id,
    })
    return NextResponse.json({ data: dept.toJSON() }, { status: 201 })
  } catch (err) {
    if (err.code === 11000) return NextResponse.json({ error: 'Department name or short code already exists' }, { status: 409 })
    console.error('[POST /api/departments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
