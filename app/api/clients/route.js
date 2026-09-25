export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Client, Project, Invoice } from '@/models'
import { sendClientActivationEmail } from '@/lib/mailer'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskList, maskDoc, CLIENT_PII, isMaskedValue } from '@/lib/pii'
import { ciContains } from '@/lib/searchMatch'
import { getConfig } from '@/lib/getConfig'
import { logActivity } from '@/lib/logActivity'
import { findOrCreateClientUser, ensureMembership } from '@/lib/clientAccess'
import { createNotification } from '@/lib/createNotification'
import { isValidObjectId } from '@/lib/objectId'
import { ACTIVE_PROJECT_STATUSES, OUTSTANDING_INVOICE_STATUSES, INVOICE_MONEY_FIELDS, sumInvoiceMoneyBDT } from '@/lib/clientStats'

// GET /api/clients
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.view')   // admin-only client directory (PII)
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page     = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit    = parseInt(searchParams.get('limit') ?? '20', 10)
    const search   = searchParams.get('search')
    const priority = searchParams.get('priority')
    const kycStatus = searchParams.get('kycStatus')
    const clientType = searchParams.get('clientType')
    const skip     = (page - 1) * limit

    let filter = {}
    if (priority)   filter.priority     = priority
    if (kycStatus)  filter['kyc.status'] = kycStatus
    if (clientType) filter.clientType   = clientType
    if (search) {
      // Match the linked user (name/email/phone) OR client-level fields. All
      // plaintext now, so substring search works directly — including company.
      // Email/phone are only searchable for callers who may see them unmasked.
      const matchingUsers = await User.find({
        $or: canDo(session, 'pii.contact.view')
          ? [{ name: ciContains(search) }, { email: ciContains(search) }, { phone: ciContains(search) }]
          : [{ name: ciContains(search) }],
      }).select('_id').lean()
      const userIds = matchingUsers.map(u => u._id)
      filter.$or = [
        { userId:     { $in: userIds } },
        { clientCode: ciContains(search) },
        { company:    ciContains(search) },
      ]
    }

    const [clients, total] = await Promise.all([
      Client.find(filter)
        .skip(skip).limit(limit).sort({ createdAt: -1 })
        .populate({ path: 'userId', select: 'id name email avatar phone isActive lastLogin' })
        .populate({ path: 'parentClientId', select: 'id clientCode company clientType', populate: { path: 'userId', select: 'name' } }),
      Client.countDocuments(filter),
    ])

    const clientIds = clients.map(c => c._id)
    const [projects, invoices] = await Promise.all([
      Project.find({ clientId: { $in: clientIds } }).select('clientId status').lean(),
      Invoice.find({ clientId: { $in: clientIds } }).select(`clientId ${INVOICE_MONEY_FIELDS}`).lean(),
    ])

    const enriched = clients.map(c => {
      const cid       = c._id.toString()
      const cProjects = projects.filter(p => p.clientId.toString() === cid)
      const cInvoices = invoices.filter(i => i.clientId.toString() === cid)
      // BDT-equivalent, net of partial payments
      const { totalRevenue, outstandingBalance } = sumInvoiceMoneyBDT(cInvoices)
      return {
        ...c.toJSON(),
        activeProjectCount: cProjects.filter(p => ACTIVE_PROJECT_STATUSES.includes(p.status)).length,
        totalRevenue,
        outstandingBalance,
      }
    })

    const [totalClients, moneyInvoices, activeProjectCount] = await Promise.all([
      Client.countDocuments(),
      Invoice.find({ status: { $in: ['PAID', ...OUTSTANDING_INVOICE_STATUSES] } }).select(INVOICE_MONEY_FIELDS).lean(),
      Project.countDocuments({ status: { $in: ACTIVE_PROJECT_STATUSES } }),
    ])
    const globalMoney = sumInvoiceMoneyBDT(moneyInvoices)

    return NextResponse.json({
      data: maskList(session, enriched, CLIENT_PII),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
      stats: {
        totalClients,
        totalRevenue:       globalMoney.totalRevenue,
        outstandingBalance: globalMoney.outstandingBalance,
        activeProjectCount,
      },
    })
  } catch (err) {
    console.error('[GET /api/clients]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/clients
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.create')
    if (denied) return denied

    await connectDB()

    const body = await request.json()
    const {
      name, email, phone,
      clientType, company, companyPhone, companyEmail, contactPerson, designation, businessType,
      industry, priority, altPhone, timezone,
      address, city, country, vatNumber, website,
      socialLinks, logo, notes,
      parentClientId,   // ← set when adding a linked company under an existing contact
    } = body

    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 422 })

    let user, isNewUser = false, activationToken = null
    let parent = null
    if (parentClientId) {
      // Linked company under an existing contact: the owner is the parent's
      // person. The email in the body is ignored (it may be a masked display value).
      if (!isValidObjectId(parentClientId)) return NextResponse.json({ error: 'Invalid parent client' }, { status: 400 })
      parent = await Client.findById(parentClientId).select('userId').lean()
      if (!parent) return NextResponse.json({ error: 'Parent client not found' }, { status: 404 })
      user = await User.findById(parent.userId)
      if (!user || user.role !== 'CLIENT') {
        return NextResponse.json({ error: 'The parent client has no client account to link' }, { status: 422 })
      }
    } else {
      if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 422 })
      if (isMaskedValue(email)) return NextResponse.json({ error: 'Enter the full email address' }, { status: 422 })

      // Find-or-create the owner by email. Existing email → just link them (no new
      // account, no new credentials); new email → create a CLIENT account with NO
      // password and a magic activation link (OTP + set-password on first access).
      // Non-CLIENT accounts (staff etc.) are rejected with a 422.
      try {
        const found = await findOrCreateClientUser({
          email, name, phone: isMaskedValue(phone) ? null : phone,
        })
        user            = found.user
        isNewUser       = found.isNew
        activationToken = found.activationToken
      } catch (e) {
        if (e?.status === 422) return NextResponse.json({ error: e.message }, { status: 422 })
        throw e
      }
    }

    const cfg = await getConfig()
    const requireKyc = cfg.verification?.clientKyc !== false

    const client = await new Client({
      userId:         user._id,
      parentClientId: parent ? parent._id : null,
      clientType:     clientType     || 'INDIVIDUAL',
      company:        company        || null,
      companyPhone:   companyPhone   || null,
      companyEmail:   companyEmail   || null,
      contactPerson:  contactPerson  || null,
      designation:    designation    || null,
      businessType:   businessType   || null,
      industry:       industry       || null,
      priority:       priority       || 'MEDIUM',
      altPhone:       altPhone       || null,
      timezone:       timezone       || null,
      address:        address        || null,
      city:           city           || null,
      country:        country        || 'Bangladesh',
      vatNumber:      vatNumber      || null,
      website:        website        || null,
      socialLinks:    socialLinks    ?? [],
      logo:           logo           || null,
      notes:          notes          || null,
      // When KYC verification is disabled, auto-verify new clients on creation
      ...(requireKyc ? {} : {
        kyc: { status: 'VERIFIED', submittedAt: new Date(), reviewedAt: new Date() },
      }),
    }).save()

    await client.populate({ path: 'userId', select: 'id name email avatar phone' })

    // Link the owner to this company (the new source of truth for access).
    await ensureMembership({ userId: user._id, clientId: client._id, role: 'OWNER', addedBy: session.user.id })

    // New (or never-activated) people get a magic activation link (no password).
    // Already-active people linked to a new company get an in-app notification.
    let emailSent = false
    if (activationToken) {
      const activationLink = `${process.env.NEXT_PUBLIC_APP_URL}/activate/${activationToken}`
      try {
        await sendClientActivationEmail({
          to:   user.email,
          name: user.name || name.trim(),
          link: activationLink,
        })
        emailSent = true
      } catch (mailErr) {
        console.warn('[POST /api/clients] Activation email failed:', mailErr.message)
      }
    } else {
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
      action:   'CREATE',
      entity:   'CLIENT',
      entityId: client._id.toString(),
      changes:  JSON.stringify({ name: name.trim(), clientCode: client.clientCode }),
      request,
    })

    return NextResponse.json({
      data:        maskDoc(session, client.toJSON(), CLIENT_PII),
      emailSent,
      linkedToExisting: !isNewUser,
      credentials: { clientCode: client.clientCode, email: parent ? undefined : email },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/clients]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
