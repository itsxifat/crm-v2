export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Department, Employee, EmployeeOnboarding } from '@/models'
import { generateShortCode } from '@/models/Department'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const dept = await Department.findById(params.id)
    if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

    const { name, shortCode, description } = await request.json()

    const oldName = dept.name
    const oldCode = dept.shortCode

    if (name?.trim()) dept.name = name.trim()

    // If shortCode explicitly provided, use it; if name changed and no shortCode, auto-regenerate
    if (shortCode?.trim()) {
      dept.shortCode = shortCode.trim().toUpperCase()
    } else if (name?.trim() && name.trim() !== oldName) {
      dept.shortCode = generateShortCode(name.trim())
    }

    if (description !== undefined) dept.description = description?.trim() || null

    await dept.save()

    // Employees (and pending onboardings) store the department short code, so
    // carry them over to the new code instead of orphaning them.
    if (oldCode && dept.shortCode !== oldCode) {
      const match = { $regex: `^${escapeRegex(oldCode)}$`, $options: 'i' }
      await Promise.all([
        Employee.updateMany({ department: match }, { $set: { department: dept.shortCode } }),
        EmployeeOnboarding.updateMany({ 'hrData.department': match }, { $set: { 'hrData.department': dept.shortCode } }),
      ])
    }
    return NextResponse.json({ data: dept.toJSON() })
  } catch (err) {
    if (err.code === 11000) return NextResponse.json({ error: 'Department name or short code already exists' }, { status: 409 })
    console.error('[PUT /api/departments/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const dept = await Department.findById(params.id)
    if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

    dept.isActive = false
    await dept.save()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/departments/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
