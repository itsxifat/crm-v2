export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Department, Employee, EmployeeOnboarding } from '@/models'
import { generateShortCode } from '@/models/Department'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
    const nameRegex = { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' }

    // A previously deleted (inactive) department with the same name is restored
    // rather than blocking the name forever. It keeps its old short code unless a
    // new one is given explicitly, so employees still referencing it reattach.
    const inactive = await Department.findOne({ name: nameRegex, isActive: false })
    if (inactive) {
      const nextCode = shortCode?.trim() ? code : inactive.shortCode
      if (nextCode !== inactive.shortCode) {
        const clash = await Department.findOne({ shortCode: nextCode, _id: { $ne: inactive._id } }).select('_id').lean()
        if (clash) return NextResponse.json({ error: `Short code "${nextCode}" is already in use` }, { status: 409 })
      }
      const oldCode = inactive.shortCode
      inactive.isActive    = true
      inactive.shortCode   = nextCode
      if (description !== undefined) inactive.description = description?.trim() || null
      await inactive.save()
      // Employees still carrying the old code follow the department to its new code.
      if (oldCode && nextCode !== oldCode) {
        const match = { $regex: `^${escapeRegex(oldCode)}$`, $options: 'i' }
        await Promise.all([
          Employee.updateMany({ department: match }, { $set: { department: nextCode } }),
          EmployeeOnboarding.updateMany({ 'hrData.department': match }, { $set: { 'hrData.department': nextCode } }),
        ])
      }
      return NextResponse.json({ data: inactive.toJSON() }, { status: 201 })
    }

    // Check uniqueness
    const existing = await Department.findOne({ $or: [
      { name: nameRegex },
      { shortCode: code },
    ]})
    if (existing) {
      if (existing.name.toLowerCase() === name.trim().toLowerCase())
        return NextResponse.json({ error: 'A department with this name already exists' }, { status: 409 })
      return NextResponse.json({ error: existing.isActive === false
        ? `Short code "${code}" belongs to a deleted department — choose another code`
        : `Short code "${code}" is already in use` }, { status: 409 })
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
