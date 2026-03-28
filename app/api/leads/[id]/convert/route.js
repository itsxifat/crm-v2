import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Client, Lead } from '@/models'
import { LeadActivity } from '@/models/Lead'
import bcrypt from 'bcryptjs'

// POST /api/leads/[id]/convert
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const lead = await Lead.findById(params.id).lean()
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    if (lead.convertedAt) {
      return NextResponse.json({ error: 'Lead has already been converted' }, { status: 400 })
    }

    const tempPassword = Math.random().toString(36).slice(-8) + 'A1!'
    const hashedPw     = await bcrypt.hash(tempPassword, 12)

    // Check if user already exists with this email
    let user = null
    if (lead.email) {
      user = await User.findOne({ email: lead.email }).lean()
    }

    // Create user if not exists
    if (!user) {
      user = await new User({
        email:    lead.email ?? `lead-${lead._id}@placeholder.com`,
        password: hashedPw,
        name:     lead.name,
        role:     'CLIENT',
        phone:    lead.phone,
        isActive: true,
      }).save()
    }

    // Create or reuse Client profile
    let client = await Client.findOne({ userId: user._id }).lean()
    if (!client) {
      client = await new Client({
        userId:   user._id,
        company:  lead.company,
        industry: lead.industry,
      }).save()
    }

    // Mark lead as converted
    await Lead.findByIdAndUpdate(params.id, { convertedAt: new Date(), status: 'WON' })

    // Log activity
    await new LeadActivity({
      leadId:      params.id,
      type:        'note',
      note:        `Lead converted to client. Client ID: ${client._id}`,
      createdById: session.user.id,
    }).save()

    return NextResponse.json({
      data: {
        clientId:     client._id.toString(),
        userId:       user._id.toString(),
        tempPassword,
        message: 'Lead successfully converted to client',
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads/[id]/convert]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
