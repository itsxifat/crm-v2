export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { maskDoc, TAX_ENTRY_PII } from '@/lib/pii'
import { getFinanceSettings } from '@/lib/finance/settings'
import { errorResponse, serializeEntry, dayKeyOfDate, partyKeyOf, todayKey } from '../../entries/_lib/common'
import {
  planCertificateUpdate, CERT_DIRECTION, CERT_TYPE_OF, certificateDue, certificateReadiness,
} from '../../entries/_lib/certificates'
import { z } from 'zod'

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const schema = z.object({
  status: z.enum(['PENDING', 'RECEIVED', 'ISSUED', 'NOT_REQUIRED']).optional(),
  number: z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(60).nullable()).optional(),
  date:   z.preprocess(v => (empty(v) ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable()).optional(),
  url:    z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(500).nullable()).optional(),
})

// POST /api/tax/certificates/[entryId] — record a certificate on one withholding entry (tax.manage)
//   { number, date, url?, status? }  VDS/TDS_RECEIVABLE ⇒ RECEIVED; VDS/TDS_PAYABLE ⇒ ISSUED (default)
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.manage')
    if (denied) return denied
    if (!isValidObjectId(params.entryId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    await connectDB()
    const entry = await TaxEntry.findById(params.entryId).lean()
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const set = planCertificateUpdate(entry, parsed.data)
    const updated = await TaxEntry.findOneAndUpdate(
      { _id: entry._id, status: 'ACTIVE', updatedAt: entry.updatedAt },
      { $set: set },
      { new: true, runValidators: true },
    ).lean()
    if (!updated) return NextResponse.json({ error: 'This entry was changed by someone else just now — reload and try again' }, { status: 409 })

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'UPDATE',
      entity: 'TAX_ENTRY',
      entityId: entry._id.toString(),
      changes: JSON.stringify({
        entryNo: entry.entryNo,
        certificate: {
          from: { status: entry.certificate?.status ?? null, number: entry.certificate?.number ?? null },
          to: { status: set['certificate.status'], number: set['certificate.number'] ?? null, date: set['certificate.date'] ? dayKeyOfDate(set['certificate.date']) : null },
        },
      }),
      request,
    })

    const settings = await getFinanceSettings()
    const data = serializeEntry(updated)
    data.direction = CERT_DIRECTION[updated.entryType]
    data.certType = CERT_TYPE_OF[updated.entryType]
    data.partyKey = partyKeyOf(updated)
    data.due = certificateDue(updated, settings, todayKey())
    if (data.direction === 'ISSUE') data.readiness = certificateReadiness(updated, settings)
    return NextResponse.json({ data: maskDoc(session, data, TAX_ENTRY_PII) })
  } catch (err) {
    return errorResponse(err, '[POST /api/tax/certificates/[entryId]]')
  }
}
