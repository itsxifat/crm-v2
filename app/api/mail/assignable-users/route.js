export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee } from '@/models'
import { requireMailManager } from '@/lib/mail/access'
import { ciContains } from '@/lib/searchMatch'
import { mailError } from '../_lib/http'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

// GET /api/mail/assignable-users?q= — active staff for the mailbox access picker (mail.manage).
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailManager(session)
    if (denied) return denied

    await connectDB()
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 100)

    const filter = { role: { $in: STAFF_ROLES }, isActive: { $ne: false } }
    if (q) filter.$or = [{ name: ciContains(q) }, { email: ciContains(q) }]
    const users = await User.find(filter).select('name email avatar role').sort({ name: 1 }).limit(30).lean()

    const employees = users.length
      ? await Employee.find({ userId: { $in: users.map(u => u._id) } }).select('userId designation position').lean()
      : []
    const designation = new Map(employees.map(e => [String(e.userId), e.designation || e.position || null]))

    return NextResponse.json({
      data: users.map(u => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        avatar: u.avatar || null,
        role: u.role,
        designation: designation.get(String(u._id)) || null,
      })),
    })
  } catch (err) {
    return mailError(err, '[GET /api/mail/assignable-users]')
  }
}
