export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { performAssetAction } from '../../_lib/actions'
import { errorResponse, loadAsset, serializeAsset, toPlain } from '../../_lib/service'

/**
 * POST /api/inventory/assets/[id]/actions
 * Body: { action, date?: 'YYYY-MM-DD', notes?, attachments?: [url], ...payload }
 *   assign / reassign   { employeeId | departmentId, locationId?, expectedReturnDate?, condition? }      inventory.assign
 *   return              { condition?, locationId? }  (condition BROKEN ⇒ DAMAGED)                         inventory.assign
 *   transfer            { locationId }                                                                    inventory.assign
 *   repair_send         { vendorId?, vendorName?, repairRef?, expectedDate? }                             inventory.assign
 *   repair_complete     { cost?, capitalize?, payment:{ mode:'REQUEST'|'NONE', vatAmount? }, condition?,
 *                         returnTo:'IN_STOCK'|'ASSIGNED', locationId?, vendorId?, vendorName?, repairRef? } inventory.assign (+manage/dispose to capitalize)
 *   report_damage       { cause, description, responsibleEmployeeId?, liabilityPct?, assessedLoss?,
 *                         recovery:{ method, amount? }, enquiryNote?, photos?, condition?, gdNumber?, reportEventId? } inventory.assign
 *   update_recovery     { eventId, status:'RECOVERED'|'WAIVED', amount?, accountId?, note? }              inventory.dispose
 *   mark_lost / mark_stolen { description, gdNumber? }; found { locationId?, condition? }                 inventory.assign
 *   retire { reason? } / reactivate                                                                       inventory.manage
 *   sell                { buyerName, buyerBin?, proceeds (excl. VAT), vatRate?, accountId, reason? }      inventory.dispose
 *   scrap               { reason, scrapValue?, buyerName?, buyerBin?, vatRate?, accountId? }              inventory.dispose
 *   write_off           { reason }; donate { recipient, reason }                                          inventory.dispose
 *   adjust_value        { impairment? | newCost?, reason }                                                inventory.dispose
 *   note                { notes }                                                                         any inventory write permission
 * Response: { data: asset, event, warnings: [] }
 */
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    await connectDB()
    const result = await performAssetAction({ assetId: params.id, body, session })

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: result.logAction,
      entity: 'ASSET',
      entityId: result.assetId,
      changes: JSON.stringify({
        tag: result.assetTag,
        action: result.action,
        from: result.fromStatus,
        to: result.toStatus,
        ...result.log,
      }),
      request,
    })

    const asset = serializeAsset(await loadAsset(params.id))
    return NextResponse.json({
      data: asset,
      event: result.event ? toPlain(result.event.toObject ? result.event.toObject() : result.event) : null,
      warnings: result.warnings,
    })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/assets/[id]/actions]')
  }
}
