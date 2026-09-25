export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, User, CompanyMembership } from '@/models'
import { findOrCreateClientUser, ensureMembership } from '@/lib/clientAccess'
import { sendClientActivationEmail } from '@/lib/mailer'
import { createNotification } from '@/lib/createNotification'
import { logActivity } from '@/lib/logActivity'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskEmail, maskPhone, isMaskedValue } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'

// GET /api/clients/[id]/members — people who can access this company
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    await connectDB()

    const showContact = canDo(session, 'pii.contact.view')
    const memberships = await CompanyMembership.find({ clientId: params.id, status: 'ACTIVE' })
      .populate({ path: 'userId', select: 'name email phone avatar isActive' })
      .sort({ role: 1, createdAt: 1 })
      .lean()

    return NextResponse.json({
      members: memberships
        .filter(m => m.userId)
        .map(m => ({
          membershipId: m._id.toString(),
          userId:       m.userId._id.toString(),
          name:         m.userId.name,
          email:        showContact ? m.userId.email : maskEmail(m.userId.email),
          phone:        showContact ? (m.userId.phone ?? null) : (maskPhone(m.userId.phone) ?? null),
          avatar:       m.userId.avatar ?? null,
          isActive:     m.userId.isActive,
          role:         m.role,
          joinedAt:     m.createdAt,
        })),
    })
  } catch (err) {
    console.error('[GET /api/clients/[id]/members]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/clients/[id]/members  { email, name?, phone?, role? }
// Add a person to this company. Existing email → linked (no new credentials);
// new email → account created + credentials sent.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    await connectDB()

    const { email, name, phone, role } = await request.json()
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 422 })
    if (isMaskedValue(email)) return NextResponse.json({ error: 'Enter the full email address' }, { status: 422 })

    const client = await Client.findById(params.id).lean()
    if (!client) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    // Already an active member?
    // Non-CLIENT accounts (staff etc.) are rejected with a 422.
    let found
    try {
      found = await findOrCreateClientUser({ email, name, phone: isMaskedValue(phone) ? null : phone })
    } catch (e) {
      if (e?.status === 422) return NextResponse.json({ error: e.message }, { status: 422 })
      throw e
    }
    const { user, isNew, activationToken } = found

    const existingMembership = await CompanyMembership.findOne({
      userId: user._id, clientId: client._id, status: 'ACTIVE',
    }).lean()
    if (existingMembership) {
      return NextResponse.json({ error: 'This person already has access to this company' }, { status: 409 })
    }

    await ensureMembership({
      userId: user._id, clientId: client._id,
      role: role === 'OWNER' ? 'OWNER' : 'MEMBER',
      addedBy: session.user.id,
    })

    // Credential delivery — new (or never-activated) person gets a magic activation link (no password).
    let emailSent = false
    if (activationToken) {
      try {
        await sendClientActivationEmail({
          to:   user.email,
          name: user.name,
          link: `${process.env.NEXT_PUBLIC_APP_URL}/activate/${activationToken}`,
        })
        emailSent = true
      } catch (e) { console.warn('[members POST] activation email failed:', e.message) }
    } else {
      // Existing person — no password, just let them know they have new access.
      createNotification({
        userId:  user._id,
        title:   'New company access',
        message: `You now have access to ${client.company || client.clientCode || 'a company'}.`,
        type:    'GENERAL',
        link:    '/client',
      })
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'MEMBER_ADD',
      entity:   'CLIENT',
      entityId: client._id.toString(),
      changes:  JSON.stringify({ clientCode: client.clientCode, member: user.email, isNew }),
      request,
    })

    return NextResponse.json({
      member: {
        userId: user._id.toString(),
        name:   user.name,
        email:  user.email,
        role:   role === 'OWNER' ? 'OWNER' : 'MEMBER',
      },
      isNew,
      emailSent,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/clients/[id]/members]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
