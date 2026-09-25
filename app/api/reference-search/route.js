export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Lead from '@/models/Lead'
import { Client, Employee, User } from '@/models'
import { ciContains } from '@/lib/searchMatch'
import { requireStaff, canDo } from '@/lib/rbac'
import { maskEmail, maskPhone } from '@/lib/pii'

const LIMIT = 8

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied

    await connectDB()

    const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
    if (!q || q.length < 1) return NextResponse.json({ data: [] })

    // Only search what the caller may view, and only match / return raw
    // email & phone when they hold pii.contact.view (otherwise this becomes a
    // reverse lookup of who owns an email or phone number).
    const canContact   = canDo(session, 'pii.contact.view')
    const canLeads     = canDo(session, 'sales.leads.view')
    const canClients   = canDo(session, 'sales.customers.view')
    const email = v => (canContact ? v : maskEmail(v))
    const phone = v => (canContact ? v : maskPhone(v))
    const rx    = ciContains(q)

    // ── Users matching by name (and email / phone when allowed) ────────────
    const userOr = [{ name: rx }]
    if (canContact) userOr.push({ email: rx }, { phone: rx })
    const matchedUsers = await User.find({ $or: userOr }).select('_id').limit(500).lean()
    const matchedUserIds = matchedUsers.map(u => u._id)

    // ── Leads ──────────────────────────────────────────────────────────────
    let matchedLeads = []
    if (canLeads) {
      const leadOr = [{ name: rx }, { company: rx }, { designation: rx }]
      if (canContact) leadOr.push({ email: rx }, { phone: rx })
      const leads = await Lead.find({ $or: leadOr })
        .select('name email phone company designation')
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean()

      matchedLeads = leads.map(l => ({
        type:     'LEAD',
        group:    'Lead',
        label:    l.name,
        sublabel: l.company ?? (l.email ? email(l.email) : null) ?? (l.phone ? phone(l.phone) : null) ?? '',
        value:    l.name,
        id:       l._id.toString(),
      }))
    }

    // ── Clients ────────────────────────────────────────────────────────────
    let matchedClients = []
    if (canClients) {
      const clients = await Client.find({
        $or: [
          { userId: { $in: matchedUserIds } },
          { company: rx }, { contactPerson: rx }, { clientCode: rx },
        ],
      })
        .select('company contactPerson clientCode clientType userId')
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .populate({ path: 'userId', select: 'name email' })
        .lean()

      matchedClients = clients
        .map(c => {
          const displayName = c.userId?.name ?? c.contactPerson ?? c.company ?? ''
          return {
            type:     'CLIENT',
            group:    'Client',
            label:    displayName,
            sublabel: c.company ?? (c.userId?.email ? email(c.userId.email) : ''),
            value:    displayName,
            id:       c._id.toString(),
          }
        })
        .filter(c => c.label)
    }

    // ── Employees (names/designations are visible to all staff) ────────────
    const employees = await Employee.find({
      resigned: { $ne: true },
      $or: [
        { userId: { $in: matchedUserIds } },
        { employeeId: rx }, { designation: rx },
      ],
    })
      .select('employeeId designation userId')
      .sort({ createdAt: -1 })
      .limit(LIMIT)
      .populate({ path: 'userId', select: 'name email' })
      .lean()

    const matchedEmployees = employees
      .map(e => {
        const name = e.userId?.name ?? ''
        return {
          type:     'EMPLOYEE',
          group:    'Employee',
          label:    name,
          sublabel: (e.userId?.email ? email(e.userId.email) : null) ?? e.designation ?? e.employeeId ?? '',
          value:    name,
          id:       e._id.toString(),
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
