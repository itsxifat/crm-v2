export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, CompanyMembership, User } from '@/models'
import { getMyCompanies, ensureMembership } from '@/lib/clientAccess'
import { createNotification } from '@/lib/createNotification'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// GET /api/clients/[id]/companies — every company this customer (the Client
// record's owner person) can access, via their CompanyMemberships. The
// customer-side counterpart to /members (which lists a company's people).
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    await connectDB()

    const customer = await Client.findById(params.id).select('userId').lean()
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    const companies = await getMyCompanies(customer.userId)

    return NextResponse.json({
      ownerUserId: customer.userId.toString(),
      companies: companies.map(c => ({
        id:         c._id.toString(),
        company:    c.company ?? null,
        clientCode: c.clientCode ?? null,
        clientType: c.clientType ?? 'INDIVIDUAL',
        logo:       c.logo ?? null,
        role:       c.membershipRole ?? 'MEMBER',
        // The customer's own account — shown for context but not unlinkable here.
        isSelf:     c._id.toString() === params.id,
      })),
    })
  } catch (err) {
    console.error('[GET /api/clients/[id]/companies]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/clients/[id]/companies  { companyId, role? }
// Link this customer (the Client record's owner person) to an existing company
// so they gain access to its portal.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    await connectDB()

    const { companyId, role } = await request.json()
    if (!companyId) return NextResponse.json({ error: 'Pick a company to link' }, { status: 422 })
    if (!isValidObjectId(companyId)) return NextResponse.json({ error: 'Invalid company' }, { status: 400 })

    const customer = await Client.findById(params.id).select('userId clientCode').lean()
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    const company = await Client.findById(companyId).select('clientCode company').lean()
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    const ownerUserId = customer.userId
    // Only CLIENT accounts may ever become company members (never staff).
    const owner = await User.findById(ownerUserId).select('role').lean()
    if (!owner || owner.role !== 'CLIENT') {
      return NextResponse.json({ error: 'This customer has no client account to link' }, { status: 422 })
    }

    const existing = await CompanyMembership.findOne({
      userId: ownerUserId, clientId: company._id, status: 'ACTIVE',
    }).lean()
    if (existing) {
      return NextResponse.json({ error: 'This customer already has access to that company' }, { status: 409 })
    }

    await ensureMembership({
      userId: ownerUserId, clientId: company._id,
      role: role === 'OWNER' ? 'OWNER' : 'MEMBER',
      addedBy: session.user.id,
    })

    createNotification({
      userId:  ownerUserId,
      title:   'New company access',
      message: `You now have access to ${company.company || company.clientCode || 'a company'}.`,
      type:    'GENERAL',
      link:    '/client',
    })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'MEMBER_ADD',
      entity:   'CLIENT',
      entityId: company._id.toString(),
      changes:  JSON.stringify({ company: company.clientCode, customer: customer.clientCode, via: 'customer-page' }),
      request,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/clients/[id]/companies]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
