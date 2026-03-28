import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client } from '@/models'

// PATCH /api/clients/[id]/kyc — submit KYC docs (client or admin)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const body = await request.json()
    const { action } = body

    const client = await Client.findById(params.id)
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // ── Admin: review (approve / reject) ──────────────────────────────────────
    if (action === 'approve' || action === 'reject') {
      if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

      client.kyc.status     = action === 'approve' ? 'VERIFIED' : 'REJECTED'
      client.kyc.remarks    = body.remarks || null
      client.kyc.reviewedBy = session.user.id
      client.kyc.reviewedAt = new Date()
      await client.save()
      await client.populate('kyc.reviewedBy', 'name')
      return NextResponse.json({ data: client.toJSON() })
    }

    // ── Submit / update KYC docs ───────────────────────────────────────────────
    const { documentType, documentNumber, primaryDoc, additionalDocs } = body

    if (documentType)   client.kyc.documentType   = documentType
    if (documentNumber !== undefined) client.kyc.documentNumber = documentNumber || null
    if (primaryDoc)     client.kyc.primaryDoc      = primaryDoc

    if (Array.isArray(additionalDocs)) {
      client.kyc.additionalDocs = additionalDocs.map(d =>
        typeof d === 'string' ? { url: d, name: null, uploadedAt: new Date() } : d
      )
    }

    // Only move to PENDING if currently NOT_SUBMITTED or REJECTED
    if (['NOT_SUBMITTED', 'REJECTED'].includes(client.kyc.status)) {
      client.kyc.status      = 'PENDING'
      client.kyc.submittedAt = new Date()
    }

    await client.save()
    await client.populate('kyc.reviewedBy', 'name')
    return NextResponse.json({ data: client.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/clients/[id]/kyc]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
