import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'

const ALLOWED_ROLES = ['SUPER_ADMIN', 'MANAGER']

const ROLE_META = {
  SUPER_ADMIN: { label: 'Super Admin',  color: 'violet' },
  MANAGER:     { label: 'Manager',      color: 'blue'   },
  EMPLOYEE:    { label: 'Employee',     color: 'emerald'},
  FREELANCER:  { label: 'Freelancer',   color: 'orange' },
  CLIENT:      { label: 'Client',       color: 'cyan'   },
  VENDOR:      { label: 'Vendor',       color: 'slate'  },
}

// GET /api/activity-logs/stats
// Returns aggregate active/total counts and last login per role.
// Optional ?role=EMPLOYEE returns the list of active users for that role.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const roleFilter = searchParams.get('role')

    // ── Active users list for a specific role ────────────────────────────────
    if (roleFilter) {
      const users = await User.find({ role: roleFilter, isActive: true })
        .select('name email avatar lastLogin role createdAt')
        .sort({ lastLogin: -1 })
        .lean()

      return NextResponse.json({
        users: users.map(u => ({
          id:        u._id.toString(),
          name:      u.name,
          email:     u.email,
          avatar:    u.avatar ?? null,
          role:      u.role,
          lastLogin: u.lastLogin ?? null,
          createdAt: u.createdAt,
        })),
      })
    }

    // ── Aggregated stats for all roles ───────────────────────────────────────
    const agg = await User.aggregate([
      {
        $group: {
          _id:         '$role',
          totalCount:  { $sum: 1 },
          activeCount: { $sum: { $cond: ['$isActive', 1, 0] } },
          lastLogin:   { $max: '$lastLogin' },
        },
      },
    ])

    // Build a map and fill in any missing roles with zeros
    const map = {}
    for (const row of agg) {
      map[row._id] = row
    }

    const roles = Object.keys(ROLE_META).map(role => ({
      role,
      label:       ROLE_META[role].label,
      color:       ROLE_META[role].color,
      totalCount:  map[role]?.totalCount  ?? 0,
      activeCount: map[role]?.activeCount ?? 0,
      lastLogin:   map[role]?.lastLogin   ?? null,
    }))

    const totalActive = roles.reduce((s, r) => s + r.activeCount, 0)
    const totalUsers  = roles.reduce((s, r) => s + r.totalCount,  0)

    return NextResponse.json({ roles, totalActive, totalUsers })
  } catch (err) {
    console.error('[GET /api/activity-logs/stats]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
