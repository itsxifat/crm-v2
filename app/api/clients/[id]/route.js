export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, CLIENT_PII, restoreMaskedValues } from '@/lib/pii'
import connectDB from '@/lib/mongodb'
import { User, Client, Project, Invoice, Agreement, Document } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import { ACTIVE_PROJECT_STATUSES, sumInvoiceMoneyBDT } from '@/lib/clientStats'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'
import { syncSoon } from '@/lib/encloud/sync'
import { z } from 'zod'

// Client fields editable through PUT. Everything else (userId, clientCode,
// parentClientId, kyc.*, isActive) has its own dedicated flow.
const EDITABLE_FIELDS = [
  'clientType', 'company', 'companyPhone', 'companyEmail', 'contactPerson', 'designation',
  'businessType', 'industry', 'priority', 'altPhone', 'timezone', 'address', 'city',
  'country', 'vatNumber', 'website', 'socialLinks', 'logo', 'notes',
]

// ── Tax identity (validated separately; blank ⇒ null) ───────────────────────
const TAX_FIELDS = ['bin', 'tin', 'vatRegistrationType', 'isVdsEntity', 'isTdsEntity', 'defaultTdsSection', 'taxNotes']
const blankToNull = v => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v)
const binField = z.preprocess(
  v => (typeof v === 'string' ? (v.replace(/\s+/g, '') || null) : v),
  z.string().regex(BIN_REGEX, 'BIN must be 9 or 13 digits, e.g. 000123456-0101')
    .transform(s => normalizeBin(s) || s).nullable().optional(),
)
const tinField = z.preprocess(
  v => (typeof v === 'string' ? (v.replace(/[\s-]+/g, '') || null) : v),
  z.string().regex(TIN_REGEX, 'TIN must be the 12-digit e-TIN').nullable().optional(),
)
const clientTaxSchema = z.object({
  bin:                 binField,
  tin:                 tinField,
  vatRegistrationType: z.preprocess(blankToNull, z.enum(['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN']).nullable().optional()),
  isVdsEntity:         z.boolean().optional(),
  isTdsEntity:         z.boolean().optional(),
  defaultTdsSection:   z.preprocess(blankToNull, z.string().max(40).nullable().optional()),
  taxNotes:            z.preprocess(blankToNull, z.string().max(2000).nullable().optional()),
})

// The client's invoices carry an issue-time buyer snapshot that includes the
// client's e-TIN — mask it like the client's own `tin` (CLIENT_PII).
const CLIENT_INVOICES_PII = {
  'pii.identity.view': [['invoices[].buyer.tin', 'identity']],
}

// GET /api/clients/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.customers.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    await connectDB()

    const client = await Client.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive lastLogin createdAt' })
      .populate({ path: 'parentClientId', select: 'id clientCode company clientType', populate: { path: 'userId', select: 'name' } })
      .populate('kyc.reviewedBy', 'name')

    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Linked companies — all other Client records sharing the same userId
    const linkedClients = await Client.find({
      userId:  client.userId._id,
      _id:     { $ne: client._id },
    }).select('id clientCode clientType company industry priority createdAt').lean()

    const [projects, invoices, documents, agreements] = await Promise.all([
      Project.find({ clientId: params.id }).sort({ createdAt: -1 }),
      Invoice.find({ clientId: params.id }).sort({ createdAt: -1 }),
      Document.find({ clientId: params.id }).sort({ createdAt: -1 }),
      Agreement.find({ clientId: params.id }).sort({ createdAt: -1 }),
    ])

    // BDT-equivalent, net of partial payments
    const { totalRevenue, outstandingBalance } = sumInvoiceMoneyBDT(invoices)
    const activeProjectCount = projects.filter(p => ACTIVE_PROJECT_STATUSES.includes(p.status)).length

    const payload = maskDoc(session, {
      ...client.toJSON(),
      linkedClients,
      projects:   projects.map(p => p.toJSON()),
      invoices:   invoices.map(i => i.toJSON()),
      documents:  documents.map(d => d.toJSON()),
      agreements: agreements.map(a => a.toJSON()),
      totalRevenue,
      outstandingBalance,
      activeProjectCount,
    }, CLIENT_PII)

    return NextResponse.json({ data: maskDoc(session, payload, CLIENT_INVOICES_PII) })
  } catch (err) {
    console.error('[GET /api/clients/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/clients/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.customers.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    await connectDB()

    const current = await Client.findById(params.id)
    if (!current) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Never write masked PII (e.g. 'j•••@g••.com') back over real data.
    const body = restoreMaskedValues(await request.json(), current.toObject()) ?? {}
    // isActive is intentionally ignored here — use PATCH /api/clients/[id]/status.
    // The login email is not editable here either (it is the account identifier).
    const { name, phone } = body

    // Whitelist client fields — never spread the body (userId, clientCode, kyc, $ops…).
    const clientSet = {}
    for (const k of EDITABLE_FIELDS) {
      if (body[k] !== undefined) clientSet[k] = body[k]
    }
    if (clientSet.socialLinks !== undefined && !Array.isArray(clientSet.socialLinks)) delete clientSet.socialLinks

    // Tax identity — masked TIN placeholders were restored above, so a value
    // reaching here is either the stored one or a newly typed one to validate.
    const taxParsed = clientTaxSchema.safeParse(body)
    if (!taxParsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: taxParsed.error.flatten() }, { status: 422 })
    }
    const taxChanges = {}
    for (const k of TAX_FIELDS) {
      const v = taxParsed.data[k]
      if (v === undefined) continue
      clientSet[k] = v
      const prev = current[k] ?? null
      if (String(prev ?? '') !== String(v ?? '')) {
        // Never copy the e-TIN itself into the audit log.
        taxChanges[k] = k === 'tin' ? (v ? 'updated' : 'cleared') : { from: prev, to: v }
      }
    }

    const userUpdate = {}
    if (typeof name === 'string' && name.trim()) userUpdate.name = name.trim()
    if (phone !== undefined) userUpdate.phone = phone || null

    // Only ever touch the linked account if it is a CLIENT (never staff).
    if (Object.keys(userUpdate).length > 0) {
      const linkedUser = await User.findById(current.userId).select('role').lean()
      if (!linkedUser || linkedUser.role !== 'CLIENT') {
        return NextResponse.json({ error: 'The linked account is not a client account and cannot be edited here' }, { status: 409 })
      }
    }

    // Validate the client update first so a failure does not leave a half-applied user update.
    if (Object.keys(clientSet).length > 0) {
      await Client.findByIdAndUpdate(params.id, { $set: clientSet }, { runValidators: true })
    }
    if (Object.keys(userUpdate).length > 0) {
      await User.findOneAndUpdate({ _id: current.userId, role: 'CLIENT' }, { $set: userUpdate })
    }

    const updated = await Client.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive' })
      .populate('kyc.reviewedBy', 'name')

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'CLIENT',
      entityId: params.id,
      changes:  JSON.stringify({
        clientCode: updated.clientCode, company: updated.company ?? null,
        ...(Object.keys(taxChanges).length ? { tax: taxChanges } : {}),
      }),
      request,
    })

    // Name / email / phone follow to encloud (when connected).
    syncSoon('client', params.id)

    return NextResponse.json({ data: maskDoc(session, updated.toJSON(), CLIENT_PII) })
  } catch (err) {
    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[PUT /api/clients/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/clients/[id] — soft delete
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.customers.delete')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    await connectDB()

    const client = await Client.findById(params.id).lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Company-level deactivation: every member loses access to THIS company;
    // the people's own accounts (and their other companies) are untouched.
    await Client.findByIdAndUpdate(params.id, { $set: { isActive: false } })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DEACTIVATE',
      entity:   'CLIENT',
      entityId: params.id,
      changes:  JSON.stringify({ clientCode: client.clientCode, isActive: false }),
      request,
    })

    return NextResponse.json({ success: true, message: 'Client deactivated' })
  } catch (err) {
    console.error('[DELETE /api/clients/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
