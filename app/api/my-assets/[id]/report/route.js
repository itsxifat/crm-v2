export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetEvent } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { createNotification } from '@/lib/createNotification'
import { logAssetEvent, assetState, HELD_STATUSES } from '@/lib/inventory/assets'
import {
  employeeForSession, inventoryManagerUserIds, toMyAsset, toReportSummary,
  REPORT_TYPES, REPORT_TYPE_META, UPLOAD_URL_RE,
} from '../../_lib/shared'
import { z } from 'zod'

const schema = z.object({
  type:        z.enum(REPORT_TYPES),
  description: z.string().trim().min(5, 'Describe the problem (at least 5 characters)').max(2000, 'Keep the description under 2000 characters'),
  photoUrl:    z.union([
    z.literal(''),
    z.string().trim().regex(UPLOAD_URL_RE, 'Attach the photo with the upload button'),
  ]).optional().nullable(),
})

/** The same person reporting the same problem twice within this window is a double submit. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000
const DUPLICATE_MESSAGE = 'You reported this a few minutes ago — the inventory team has been told'

// POST /api/my-assets/[id]/report  { type: 'DAMAGE'|'NOT_WORKING'|'LOST', description, photoUrl }
// The assignee flags a problem. The asset's status does NOT change — an inventory
// manager assesses it (report damage / send to repair / mark lost) from the asset page.
//   DAMAGE, NOT_WORKING → DAMAGE_REPORTED event (details.reportedByEmployee = true, not yet assessed)
//   LOST                → LOST event with the status unchanged (details.confirmed = false)
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let body
    try { body = await request.json() } catch { body = {} }
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const { type, description } = parsed.data
    const photoUrl = parsed.data.photoUrl?.trim() || null
    const meta = REPORT_TYPE_META[type]

    await connectDB()

    const emp = await employeeForSession(session)
    if (!emp) return NextResponse.json({ error: 'Your account is not linked to an employee profile' }, { status: 403 })

    const asset = await Asset.findById(params.id)
      .populate({ path: 'categoryId', select: 'name code' })
      .populate({ path: 'locationId', select: 'name code' })
      .lean()
    if (!asset || String(asset.assignedEmployeeId ?? '') !== String(emp._id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!HELD_STATUSES.includes(asset.status)) {
      return NextResponse.json({ error: 'This asset is no longer issued to you' }, { status: 409 })
    }

    const now = new Date()
    const windowStart = new Date(now.getTime() - DUPLICATE_WINDOW_MS)

    // Fast path (also covers reports written before the claim slot existed).
    const recent = await AssetEvent.exists({
      assetId: asset._id,
      createdBy: session.user.id,
      'details.reportedByEmployee': true,
      'details.reportType': type,
      date: { $gte: windowStart },
    })
    if (recent) {
      return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 })
    }

    // Atomic claim: only one of two simultaneous submits by this reporter takes the
    // slot; another reporter (e.g. the next holder) or another type is unaffected.
    // timestamps off — Asset.updatedAt is the optimistic lock for manager edits/actions.
    const slot = `selfReportClaims.${type}`
    const claim = await Asset.updateOne(
      {
        _id: asset._id,
        assignedEmployeeId: emp._id,
        status: { $in: HELD_STATUSES },
        $nor: [{ [`${slot}.userId`]: session.user.id, [`${slot}.at`]: { $gte: windowStart } }],
      },
      { $set: { [slot]: { userId: session.user.id, at: now } } },
      { timestamps: false },
    )
    if (!claim.matchedCount) {
      const stillHeld = await Asset.exists({ _id: asset._id, assignedEmployeeId: emp._id, status: { $in: HELD_STATUSES } })
      return NextResponse.json({ error: stillHeld ? DUPLICATE_MESSAGE : 'This asset is no longer issued to you' }, { status: 409 })
    }

    const state = assetState(asset)
    let event
    try {
      event = await logAssetEvent({
        asset,
        type: meta.eventType,
        date: now,
        from: state,
        to: state,
        notes: description,
        attachments: photoUrl ? [photoUrl] : [],
        details: {
          reportedByEmployee: true,
          reportType: type,
          description,
          photos: photoUrl ? [photoUrl] : [],
          reporterEmployeeId: String(emp._id),
          assessed: false,
          ...(type === 'LOST' ? { confirmed: false } : { cause: 'UNKNOWN' }),
        },
        session,
      })
    } catch (err) {
      // Release our claim so the employee can submit again.
      await Asset.updateOne(
        { _id: asset._id, [`${slot}.userId`]: session.user.id, [`${slot}.at`]: now },
        { $unset: { [slot]: 1 } },
        { timestamps: false },
      ).catch(e => console.error('[POST /api/my-assets/[id]/report] claim release failed', e))
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'ASSET',
      entityId: String(asset._id),
      changes:  JSON.stringify({ assetTag: asset.assetTag, event: meta.eventType, reportType: type, selfService: true }),
      request,
    })

    const who = session.user.name ?? 'An employee'
    const recipients = await inventoryManagerUserIds({ excludeUserId: session.user.id })
    if (recipients.length) {
      const short = description.length > 140 ? `${description.slice(0, 137)}…` : description
      createNotification({
        userId:  recipients,
        type:    'ASSET',
        title:   `${meta.label} reported: ${asset.assetTag}`,
        message: `${who} says "${asset.name}" ${meta.verb}: ${short}`,
        link:    `/admin/inventory/assets/${asset._id}`,
      }).catch(() => {})
    }

    return NextResponse.json({
      data: {
        event: { id: String(event._id), type: event.type, date: event.date },
        asset: toMyAsset(asset, { lastReport: toReportSummary(event.toObject ? event.toObject() : event) }),
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/my-assets/[id]/report]', err)
    return NextResponse.json({ error: err.status ? err.message : 'Internal server error' }, { status: err.status ?? 500 })
  }
}
