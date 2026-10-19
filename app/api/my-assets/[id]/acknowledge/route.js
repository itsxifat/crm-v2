export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { createNotification } from '@/lib/createNotification'
import { logAssetEvent, assetState, HELD_STATUSES } from '@/lib/inventory/assets'
import { employeeForSession, inventoryManagerUserIds, toMyAsset } from '../../_lib/shared'
import { z } from 'zod'

const schema = z.object({
  decision: z.enum(['ACCEPTED', 'DECLINED']),
  note: z.string().trim().max(1000, 'Keep the note under 1000 characters').optional().nullable(),
}).superRefine((v, ctx) => {
  if (v.decision === 'DECLINED' && (!v.note || v.note.length < 5)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Tell us why you are declining (at least 5 characters)' })
  }
})

// Which acknowledgement states each decision may replace. Accepting is also
// allowed after a decline (changed mind) or when no acknowledgement was asked
// for (voluntary confirmation, e.g. migrated legacy items).
const ALLOWED_FROM = {
  ACCEPTED: ['PENDING', 'DECLINED', 'NOT_REQUIRED'],
  DECLINED: ['PENDING'],
}

// POST /api/my-assets/[id]/acknowledge  { decision: 'ACCEPTED'|'DECLINED', note }
// Only the current assignee. Writes an ACKNOWLEDGED / ACK_DECLINED event and
// tells the inventory team about a decline.
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
    const { decision } = parsed.data
    const note = parsed.data.note?.trim() || null

    await connectDB()

    const emp = await employeeForSession(session)
    if (!emp) return NextResponse.json({ error: 'Your account is not linked to an employee profile' }, { status: 403 })

    const asset = await Asset.findById(params.id)
      .populate({ path: 'categoryId', select: 'name code' })
      .populate({ path: 'locationId', select: 'name code' })
      .lean()
    // Someone else's asset looks exactly like a missing one.
    if (!asset || String(asset.assignedEmployeeId ?? '') !== String(emp._id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!HELD_STATUSES.includes(asset.status)) {
      return NextResponse.json({ error: 'This asset is no longer issued to you' }, { status: 409 })
    }

    const previous = asset.acknowledgement ?? {}
    const current = previous.status ?? 'NOT_REQUIRED'
    if (current === decision) {
      return NextResponse.json({
        error: decision === 'ACCEPTED' ? 'You have already acknowledged this asset' : 'You have already declined this asset',
      }, { status: 409 })
    }
    if (!ALLOWED_FROM[decision].includes(current)) {
      return NextResponse.json({ error: 'This asset is not waiting for your acknowledgement' }, { status: 409 })
    }

    const now = new Date()
    // Atomic: only flips the state we just validated, and only while still assigned to this employee.
    const updated = await Asset.findOneAndUpdate(
      {
        _id: asset._id,
        assignedEmployeeId: emp._id,
        status: { $in: HELD_STATUSES },
        ...(current === 'NOT_REQUIRED'
          ? { $or: [{ 'acknowledgement.status': 'NOT_REQUIRED' }, { 'acknowledgement.status': { $exists: false } }, { acknowledgement: null }] }
          : { 'acknowledgement.status': current }),
      },
      {
        $set: {
          'acknowledgement.status': decision,
          'acknowledgement.at':     now,
          'acknowledgement.note':   note,
          updatedBy:                session.user.id,
        },
      },
      { new: true },
    )
      .populate({ path: 'categoryId', select: 'name code' })
      .populate({ path: 'locationId', select: 'name code' })
      .lean()

    if (!updated) {
      return NextResponse.json({ error: 'This asset changed in the meantime — refresh and try again' }, { status: 409 })
    }

    try {
      const state = assetState(updated)
      await logAssetEvent({
        asset: updated,
        type: decision === 'ACCEPTED' ? 'ACKNOWLEDGED' : 'ACK_DECLINED',
        date: now,
        from: state,
        to: state,
        notes: note,
        details: {
          decision,
          previousStatus: current,
          assignEventId: previous.eventId ? String(previous.eventId) : null,
          selfService: true,
        },
        session,
      })
    } catch (err) {
      // Keep the asset and its history in step: undo the flip if the event could not be written.
      await Asset.updateOne(
        { _id: updated._id, 'acknowledgement.status': decision },
        { $set: { 'acknowledgement.status': current, 'acknowledgement.at': previous.at ?? null, 'acknowledgement.note': previous.note ?? null } },
      ).catch(e => console.error('[POST /api/my-assets/[id]/acknowledge] rollback failed', e))
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'STATUS_CHANGE',
      entity:   'ASSET',
      entityId: String(updated._id),
      changes:  JSON.stringify({
        assetTag: updated.assetTag,
        acknowledgement: { from: current, to: decision },
        ...(note ? { note } : {}),
      }),
      request,
    })

    if (decision === 'DECLINED') {
      const who = session.user.name ?? 'An employee'
      const recipients = await inventoryManagerUserIds({ excludeUserId: session.user.id })
      if (recipients.length) {
        createNotification({
          userId:  recipients,
          type:    'ASSET',
          title:   `Asset declined: ${updated.assetTag}`,
          message: `${who} declined "${updated.name}". Reason: ${note.length > 160 ? `${note.slice(0, 157)}…` : note}`,
          link:    `/admin/inventory/assets/${updated._id}`,
        }).catch(() => {})
      }
    }

    return NextResponse.json({ data: toMyAsset(updated) })
  } catch (err) {
    console.error('[POST /api/my-assets/[id]/acknowledge]', err)
    return NextResponse.json({ error: err.status ? err.message : 'Internal server error' }, { status: err.status ?? 500 })
  }
}
