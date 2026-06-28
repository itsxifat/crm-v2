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

const ALLOWED = ['SUPER_ADMIN', 'MANAGER']

// GET /api/clients/[id]/members — people who can access this company
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!ALLOWED.includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

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
          email:        m.userId.email,
          phone:        m.userId.phone ?? null,
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!ALLOWED.includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const { email, name, phone, role } = await request.json()
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 422 })

    const client = await Client.findById(params.id).lean()
    if (!client) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    // Already an active member?
    const { user, isNew, activationToken } = await findOrCreateClientUser({
      email, name, phone, addedBy: session.user.id,
    })

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

    // Credential delivery — new person gets a magic activation link (no password).
    let emailSent = false
    if (isNew && activationToken) {
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
