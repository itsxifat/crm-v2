export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User, Employee } from '@/models'
import { ciContains } from '@/lib/searchMatch'
import { authorize, VIEW, handleError } from '@/lib/organizer/http'
import { parseIdList, parseSearch } from '@/lib/organizer/validation'
import { STAFF_ROLES } from '@/lib/organizer/refs'

// GET /api/organizer/people?q=  (or ?ids=a,b to resolve specific people)
// → active staff [{ id, name, email, avatar, designation }] (≤ 30)
export async function GET(request) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    await connectDB()

    const sp = new URL(request.url).searchParams
    const q = parseSearch(sp.get('q'))
    const ids = parseIdList(sp.get('ids'))
    if (ids && !ids.length) return NextResponse.json({ data: [] })

    const filter = { role: { $in: STAFF_ROLES }, isActive: { $ne: false } }
    if (ids) filter._id = { $in: ids }
    if (q) filter.$or = [{ name: ciContains(q) }, { email: ciContains(q) }]
    const users = await User.find(filter).select('name email avatar role').sort({ name: 1 }).limit(30).lean()

    const employees = users.length
      ? await Employee.find({ userId: { $in: users.map(u => u._id) } }).select('userId designation position').lean()
      : []
    const designation = new Map(employees.map(e => [String(e.userId), e.designation || e.position || null]))

    return NextResponse.json({
      data: users.map(u => ({
        id:          String(u._id),
        name:        u.name,
        email:       u.email,
        avatar:      u.avatar || null,
        role:        u.role,
        designation: designation.get(String(u._id)) || null,
      })),
    })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/people]')
  }
}
