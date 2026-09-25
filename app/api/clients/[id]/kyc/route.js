export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, CLIENT_PII, isMaskedValue, containsMaskedValue } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'

const DOC_TYPES = ['NID', 'PASSPORT', 'TRADE_LICENSE', 'OTHERS']

// PATCH /api/clients/[id]/kyc — submit / review KYC docs (staff with customer-edit permission)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const body = await request.json()
    const { action } = body

    const client = await Client.findById(params.id)
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // ── Admin: review (approve / reject) ──────────────────────────────────────
    if (action === 'approve' || action === 'reject') {
      if (client.kyc.status !== 'PENDING')
        return NextResponse.json({ error: 'Only KYC submissions pending review can be approved or rejected' }, { status: 409 })
      if (action === 'approve' && !client.kyc.primaryDoc)
        return NextResponse.json({ error: 'Cannot approve KYC without a primary document' }, { status: 409 })

      client.kyc.status     = action === 'approve' ? 'VERIFIED' : 'REJECTED'
      client.kyc.remarks    = body.remarks || null
      client.kyc.reviewedBy = session.user.id
      client.kyc.reviewedAt = new Date()
      await client.save()
      await client.populate('kyc.reviewedBy', 'name')
      return NextResponse.json({ data: maskDoc(session, client.toJSON(), CLIENT_PII) })
    }

    // ── Submit / update KYC docs ───────────────────────────────────────────────
    if (client.kyc.status === 'VERIFIED')
      return NextResponse.json({ error: 'KYC is already verified; documents cannot be changed' }, { status: 409 })

    const { documentType, documentNumber, primaryDoc, additionalDocs } = body

    if (documentType !== undefined && documentType !== null && !DOC_TYPES.includes(documentType))
      return NextResponse.json({ error: 'Invalid document type' }, { status: 422 })

    // Masked placeholders (pre-filled from a masked GET) must never overwrite the real value.
    if (documentType)   client.kyc.documentType   = documentType
    if (documentNumber !== undefined && !isMaskedValue(documentNumber)) client.kyc.documentNumber = documentNumber || null
    if (primaryDoc && !isMaskedValue(primaryDoc)) client.kyc.primaryDoc = primaryDoc

    if (Array.isArray(additionalDocs) && !containsMaskedValue(additionalDocs)) {
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
    return NextResponse.json({ data: maskDoc(session, client.toJSON(), CLIENT_PII) })
  } catch (err) {
    console.error('[PATCH /api/clients/[id]/kyc]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
