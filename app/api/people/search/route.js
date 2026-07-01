export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee, Freelancer } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { ciContains } from '@/lib/searchMatch'

// GET /api/people/search?q=&types=EMPLOYEE,FREELANCER,AGENCY&limit=20
// Unified, lightweight assignee search across employees, freelancers and
// agencies — powers the advanced people picker. Returns minimal display fields
// only (no emails/bank details), staff-guarded.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const q     = (searchParams.get('q') ?? '').trim()
    const types = (searchParams.get('types') ?? 'EMPLOYEE,FREELANCER,AGENCY').split(',').map(s => s.trim())
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50)

    // Resolve which users match the query by name/email (one lookup, reused below).
    let matchingUserIds = null
    if (q) {
      const users = await User.find({ $or: [{ name: ciContains(q) }, { email: ciContains(q) }] })
        .select('_id').lean()
      matchingUserIds = users.map(u => u._id)
    }

    const results = []

    if (types.includes('EMPLOYEE')) {
      const filter = { resigned: { $ne: true } }
      if (q) filter.$or = [
        { userId: { $in: matchingUserIds } },
        { department: ciContains(q) }, { position: ciContains(q) }, { designation: ciContains(q) },
      ]
      const employees = await Employee.find(filter).limit(limit)
        .populate({ path: 'userId', select: 'name avatar isActive' }).lean()
      for (const e of employees) {
        if (e.userId?.isActive === false) continue
        results.push({
          id: e._id.toString(), type: 'EMPLOYEE',
          name: e.userId?.name ?? 'Employee', avatar: e.userId?.avatar ?? null,
          sub: [e.designation || e.position, e.department].filter(Boolean).join(' · ') || 'Employee',
        })
      }
    }

    const wantFreelancer = types.includes('FREELANCER')
    const wantAgency     = types.includes('AGENCY')
    if (wantFreelancer || wantAgency) {
      const typeFilter = wantFreelancer && wantAgency ? ['FREELANCER', 'AGENCY']
        : wantFreelancer ? ['FREELANCER'] : ['AGENCY']
      const filter = { type: { $in: typeFilter } }
      if (q) filter.$or = [
        { userId: { $in: matchingUserIds } },
        { skills: ciContains(q) }, { 'agencyInfo.agencyName': ciContains(q) },
      ]
      const freelancers = await Freelancer.find(filter).limit(limit)
        .populate({ path: 'userId', select: 'name avatar isActive' }).lean()
      for (const f of freelancers) {
        if (f.userId?.isActive === false || f.disabledAt) continue
        const isAgency = f.type === 'AGENCY'
        results.push({
          id: f._id.toString(), type: f.type,
          name: isAgency ? (f.agencyInfo?.agencyName ?? f.userId?.name ?? 'Agency') : (f.userId?.name ?? 'Freelancer'),
          avatar: f.userId?.avatar ?? null,
          sub: isAgency ? 'Agency' : (f.employmentMode === 'SALARY' ? 'Salary freelancer' : (f.skills ? f.skills.split(',')[0].trim() : 'Freelancer')),
          mode: f.employmentMode ?? 'PROJECT',
          currency: f.paymentCurrency ?? 'BDT',
        })
      }
    }

    return Response.json({ data: results.slice(0, limit) })
  } catch (err) {
    console.error('[people/search GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
