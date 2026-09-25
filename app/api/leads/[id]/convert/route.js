export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Client, Lead, Quotation } from '@/models'
import { LeadActivity } from '@/models/Lead'
import bcrypt from 'bcryptjs'
import { ciEquals } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { restoreMaskedValues } from '@/lib/pii'
import { requirePerm } from '@/lib/rbac'
import { canAccessLead } from '@/lib/leadAccess'
import { isValidObjectId } from '@/lib/objectId'
import { ensureMembership } from '@/lib/clientAccess'
import { validateStrongPassword } from '@/lib/passwordPolicy'
import { getConfig } from '@/lib/getConfig'
import CompanyMembership from '@/models/CompanyMembership'

// POST /api/leads/[id]/convert
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    // Conversion creates a client account + profile and updates the lead
    const denied = requirePerm(session, 'sales.customers.create') ?? requirePerm(session, 'sales.leads.update')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    await connectDB()

    const rawBody = await request.json().catch(() => ({}))

    const lead = await Lead.findById(params.id).lean()
    if (!lead || !(await canAccessLead(session, lead))) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // The convert form is pre-filled from the masked lead — swap any masked
    // placeholder for the real lead value (unmatched ones are dropped).
    const body = restoreMaskedValues(rawBody ?? {}, lead) ?? {}

    if (lead.convertedAt) {
      return NextResponse.json({ error: 'Lead has already been converted' }, { status: 400 })
    }

    // Email is mandatory — it's the client's login identifier
    const email = (body.email || lead.email || '').trim()
    if (!email) {
      return NextResponse.json({ error: 'Email is required for client login' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    // Don't silently hijack an existing account — make the admin pick a free email
    const existing = await User.findOne({ email: ciEquals(email) }).lean()
    if (existing) {
      return NextResponse.json({ error: 'A user already exists with this email. Use a different email.' }, { status: 409 })
    }

    // Use the admin-supplied password, otherwise auto-generate a temp one
    const providedPassword = (typeof body.password === 'string' ? body.password : '').trim()
    if (providedPassword) {
      const pwError = validateStrongPassword(providedPassword)
      if (pwError) return NextResponse.json({ error: pwError }, { status: 422 })
    }
    const tempPassword     = providedPassword || (Math.random().toString(36).slice(-8) + 'A1!')
    const hashedPw         = await bcrypt.hash(tempPassword, 12)
    // Auto-generated passwords must always be changed; respect the flag otherwise
    const mustChangePassword = providedPassword ? !!body.requirePasswordChange : true

    const cfg = await getConfig()
    const requireKyc = cfg.verification?.clientKyc !== false

    // Claim the lead atomically so concurrent/double submits can't convert it twice
    const claimed = await Lead.findOneAndUpdate(
      { _id: params.id, convertedAt: null },
      { $set: { convertedAt: new Date() } },
    )
    if (!claimed) {
      return NextResponse.json({ error: 'Lead has already been converted' }, { status: 400 })
    }

    let user = null
    let client = null
    try {
      user = await new User({
        email,
        password: hashedPw,
        name:     (body.name || lead.name || '').trim() || lead.name,
        role:     'CLIENT',
        phone:    (body.phone ?? lead.phone) || null,
        isActive: true,
        mustChangePassword,
      }).save()

      // Create the Client profile from the supplied details (falling back to lead data)
      client = await new Client({
        userId:       user._id,
        clientType:   body.clientType === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY',
        company:      (body.company ?? lead.company) || null,
        designation:  (body.designation ?? lead.designation) || null,
        companyEmail: body.companyEmail || null,
        companyPhone: body.companyPhone || null,
        industry:     body.industry || null,
        website:      body.website || null,
        address:      body.address || null,
        city:         (body.city ?? lead.location) || null,
        country:      body.country || null,
        // When KYC verification is disabled, auto-verify new clients on creation (same as POST /api/clients)
        ...(requireKyc ? {} : {
          kyc: { status: 'VERIFIED', submittedAt: new Date(), reviewedAt: new Date() },
        }),
      }).save()

      // Client-portal access is governed by an ACTIVE membership
      await ensureMembership({ userId: user._id, clientId: client._id, role: 'OWNER', addedBy: session.user.id })
    } catch (err) {
      // Roll back so the lead can be converted again (no orphan login blocking the email)
      await Promise.allSettled([
        client ? Client.deleteOne({ _id: client._id }) : null,
        user ? CompanyMembership.deleteMany({ userId: user._id }) : null,
        user ? User.deleteOne({ _id: user._id }) : null,
        Lead.updateOne({ _id: params.id }, { $set: { convertedAt: null } }),
      ])
      throw err
    }

    // Mark lead as won
    await Lead.updateOne({ _id: params.id }, { $set: { status: 'WON' } })

    // Transfer all lead quotations to the new client so they appear in their proposals
    await Quotation.updateMany({ leadId: params.id }, { $set: { clientId: client._id } })

    // Log activity
    await new LeadActivity({
      leadId:      params.id,
      type:        'note',
      note:        `Lead converted to client. Client ID: ${client._id}`,
      createdById: session.user.id,
    }).save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CONVERT',
      entity:   'LEAD',
      entityId: params.id,
      changes:  JSON.stringify({ name: lead.name, clientId: client._id.toString() }),
      request,
    })

    return NextResponse.json({
      data: {
        clientId:     client._id.toString(),
        userId:       user._id.toString(),
        email,
        tempPassword,
        message: 'Lead successfully converted to client',
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads/[id]/convert]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
