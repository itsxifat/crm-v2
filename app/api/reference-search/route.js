export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Lead from '@/models/Lead'
import { Client, Employee, User } from '@/models'
import { blindIndex } from '@/lib/encryption'

// Fetch a batch, decrypt via Mongoose plugin, then filter in JS.
// This is the only reliable approach for AES-GCM encrypted fields
// where MongoDB-level regex cannot operate on ciphertext.
const BATCH = 300

function matchesQuery(value, q) {
  if (!value) return false
  return String(value).toLowerCase().includes(q)
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
    if (!q || q.length < 1) return NextResponse.json({ data: [] })

    const qLower = q.toLowerCase()

    // ── Blind-index exact matches (email + phone) on User ──────────────────
    const emailToken = blindIndex(q, 'users', 'email')
    const phoneToken = blindIndex(q, 'users', 'phone')
    const exactUsers = await User.find({
      $or: [{ emailIdx: emailToken }, { phoneIdx: phoneToken }],
    }).select('+emailIdx +phoneIdx').lean()
    const exactUserIds = new Set(exactUsers.map(u => u._id.toString()))

    // ── Leads ──────────────────────────────────────────────────────────────
    // Fetch recent leads; Mongoose post('find') hook decrypts all fields
    const leads = await Lead.find({})
      .select('name email phone company designation')
      .sort({ createdAt: -1 })
      .limit(BATCH)

    const matchedLeads = leads
      .filter(l =>
        matchesQuery(l.name,        qLower) ||
        matchesQuery(l.email,       qLower) ||
        matchesQuery(l.phone,       qLower) ||
        matchesQuery(l.company,     qLower) ||
        matchesQuery(l.designation, qLower)
      )
      .slice(0, 8)
      .map(l => ({
        type:     'LEAD',
        group:    'Lead',
        label:    l.name,
        sublabel: l.company ?? l.email ?? l.phone ?? '',
        value:    l.name,
        id:       l.id ?? l._id.toString(),
      }))

    // ── Clients ────────────────────────────────────────────────────────────
    const clients = await Client.find({})
      .select('company contactPerson clientCode clientType')
      .sort({ createdAt: -1 })
      .limit(BATCH)
      .populate({ path: 'userId', select: 'name email phone' })

    const matchedClients = clients
      .filter(c => {
        const uid = c.userId?._id?.toString()
        return (
          (uid && exactUserIds.has(uid)) ||
          matchesQuery(c.userId?.name,    qLower) ||
          matchesQuery(c.userId?.email,   qLower) ||
          matchesQuery(c.userId?.phone,   qLower) ||
          matchesQuery(c.company,         qLower) ||
          matchesQuery(c.contactPerson,   qLower) ||
          matchesQuery(c.clientCode,      qLower)
        )
      })
      .slice(0, 8)
      .map(c => {
        const displayName = c.userId?.name ?? c.contactPerson ?? c.company ?? ''
        return {
          type:     'CLIENT',
          group:    'Client',
          label:    displayName,
          sublabel: c.company ?? c.userId?.email ?? '',
          value:    displayName,
          id:       c.id ?? c._id.toString(),
        }
      })
      .filter(c => c.label)

    // ── Employees ──────────────────────────────────────────────────────────
    const employees = await Employee.find({ resigned: { $ne: true } })
      .select('employeeId designation')
      .sort({ createdAt: -1 })
      .limit(BATCH)
      .populate({ path: 'userId', select: 'name email phone' })

    const matchedEmployees = employees
      .filter(e => {
        const uid = e.userId?._id?.toString()
        return (
          (uid && exactUserIds.has(uid)) ||
          matchesQuery(e.userId?.name,    qLower) ||
          matchesQuery(e.userId?.email,   qLower) ||
          matchesQuery(e.userId?.phone,   qLower) ||
          matchesQuery(e.employeeId,      qLower) ||
          matchesQuery(e.designation,     qLower)
        )
      })
      .slice(0, 8)
      .map(e => {
        const name = e.userId?.name ?? ''
        return {
          type:     'EMPLOYEE',
          group:    'Employee',
          label:    name,
          sublabel: e.userId?.email ?? e.designation ?? e.employeeId ?? '',
          value:    name,
          id:       e.id ?? e._id.toString(),
        }
      })
      .filter(e => e.label)

    const all = [...matchedLeads, ...matchedClients, ...matchedEmployees]

    // Deduplicate by (type + label)
    const seen = new Set()
    const results = all.filter(r => {
      const key = `${r.type}:${r.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return NextResponse.json({ data: results })
  } catch (err) {
    console.error('[GET /api/reference-search]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
