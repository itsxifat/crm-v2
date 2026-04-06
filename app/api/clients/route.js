export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Client, Project, Invoice } from '@/models'
import bcrypt from 'bcryptjs'
import { sendClientWelcomeEmail } from '@/lib/mailer'
import { sendClientWelcomeWhatsApp } from '@/lib/whatsapp'
import { canAccess } from '@/lib/permissions'

// GET /api/clients
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page     = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit    = parseInt(searchParams.get('limit') ?? '20', 10)
    const search   = searchParams.get('search')
    const priority = searchParams.get('priority')
    const kycStatus = searchParams.get('kycStatus')
    const skip     = (page - 1) * limit

    let filter = {}
    if (priority)  filter.priority     = priority
    if (kycStatus) filter['kyc.status'] = kycStatus
    if (search) {
      const matchingUsers = await User.find({
        $or: [
          { name:  { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
        ],
      }).select('_id').lean()
      const userIds = matchingUsers.map(u => u._id)
      filter.$or = [
        { userId:        { $in: userIds } },
        { company:       { $regex: search, $options: 'i' } },
        { clientCode:    { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
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
      Invoice.find({ clientId: { $in: clientIds } }).select('clientId total status').lean(),
    ])

    const enriched = clients.map(c => {
      const cid       = c._id.toString()
      const cProjects = projects.filter(p => p.clientId.toString() === cid)
      const cInvoices = invoices.filter(i => i.clientId.toString() === cid)
      return {
        ...c.toJSON(),
        activeProjectCount: cProjects.filter(p => ['IN_PROGRESS','ACTIVE'].includes(p.status)).length,
        totalRevenue:       cInvoices.filter(i => i.status === 'PAID').reduce((s, i) => s + i.total, 0),
        outstandingBalance: cInvoices.filter(i => ['SENT','PARTIALLY_PAID','OVERDUE'].includes(i.status)).reduce((s, i) => s + i.total, 0),
      }
    })

    const [totalClients, paidInvoices, unpaidInvoices, activeProjectCount] = await Promise.all([
      Client.countDocuments(),
      Invoice.find({ status: 'PAID' }).select('total').lean(),
      Invoice.find({ status: { $in: ['SENT','OVERDUE','PARTIALLY_PAID'] } }).select('total').lean(),
      Project.countDocuments({ status: { $in: ['IN_PROGRESS','ACTIVE'] } }),
    ])

    return NextResponse.json({
      data: enriched,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
      stats: {
        totalClients,
        totalRevenue:       paidInvoices.reduce((s, i) => s + i.total, 0),
        outstandingBalance: unpaidInvoices.reduce((s, i) => s + i.total, 0),
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canAccess(session, 'clients', 'create'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 422 })

    let user       = await User.findOne({ email: email.trim().toLowerCase() }).lean()
    let rawPw      = null
    let isNewUser  = false

    if (user) {
      // Existing contact person — only allowed when explicitly linking a new company (parentClientId provided)
      if (!parentClientId) {
        return NextResponse.json({ error: 'A user with this email already exists. To add a linked company, select the parent client.' }, { status: 409 })
      }
      // Verify the parent client belongs to this user
      const parentClient = await Client.findById(parentClientId).lean()
      if (!parentClient) return NextResponse.json({ error: 'Parent client not found' }, { status: 404 })
      if (parentClient.userId.toString() !== user._id.toString()) {
        return NextResponse.json({ error: 'Parent client does not match this contact email' }, { status: 422 })
      }
    } else {
      // New contact person — create User account
      const chars    = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
      rawPw          = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
      const hashedPw = await bcrypt.hash(rawPw, 12)
      user           = await new User({ email: email.trim().toLowerCase(), password: hashedPw, name: name.trim(), role: 'CLIENT', phone, isActive: true }).save()
      isNewUser      = true
    }

    const client = await new Client({
      userId:         user._id,
      parentClientId: parentClientId || null,
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
    }).save()

    await client.populate({ path: 'userId', select: 'id name email avatar phone' })

    // Send welcome email + WhatsApp only for brand-new users
    let emailSent = false
    if (isNewUser) {
      try {
        await sendClientWelcomeEmail({
          to:         email.trim().toLowerCase(),
          name:       name.trim(),
          clientCode: client.clientCode,
          password:   rawPw,
          phone:      phone || null,
        })
        emailSent = true
      } catch (mailErr) {
        console.warn('[POST /api/clients] Email failed:', mailErr.message)
      }

      if (phone) {
        sendClientWelcomeWhatsApp({
          to:         phone,
          name:       name.trim(),
          clientCode: client.clientCode,
          password:   rawPw,
          phone:      phone,
        })
      }
    }

    return NextResponse.json({
      data:        client.toJSON(),
      emailSent,
      linkedToExisting: !isNewUser,
      credentials: { clientCode: client.clientCode, email },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/clients]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
