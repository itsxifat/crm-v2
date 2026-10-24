export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset } from '@/models'
import { canDoAny, requireStaff } from '@/lib/rbac'
import { compactCode, codeEquals } from '@/lib/codes'
import { employeeOfSession, errorResponse } from '../../_lib/service'

// The asset detail page (/admin/inventory/assets/[id]) is open to these (lib/rbac ROUTE_PERMISSIONS).
const DETAIL_PERMS = ['inventory.view', 'inventory.manage']

// Tags are letters and digits (ENLAP00042). Labels printed before 2026-10 carry
// hyphens (EN-LAP-00042) and stay on the equipment, so separators are ignored.
const TAG_RE = /^[A-Z0-9]{2,40}$/

// GET /api/inventory/assets/tag/[tag] — resolve a scanned label to the asset id.
// Inventory staff get { id, canView: true }; the employee holding the asset gets { id, mine: true }
// (also staff whose onboarding is still pending — they can only reach My Assets).
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    let tag = ''
    try { tag = decodeURIComponent(String(params.tag ?? '')).trim().toUpperCase() } catch { tag = '' }
    if (tag.length > 60 || !TAG_RE.test(compactCode(tag))) return NextResponse.json({ error: 'Not a valid asset tag' }, { status: 404 })

    await connectDB()
    const asset = await Asset.findOne({ assetTag: codeEquals(tag) })
      .select('_id assetTag name status assignedEmployeeId assignedUserId isArchived')
      .lean()
    if (!asset) return NextResponse.json({ error: `No asset is registered with tag ${tag}` }, { status: 404 })

    const base = { id: String(asset._id), assetTag: asset.assetTag, name: asset.name, status: asset.status }
    const emp = await employeeOfSession(session)
    const mine = Boolean(asset.assignedUserId && String(asset.assignedUserId) === String(session.user.id)) ||
      Boolean(emp && asset.assignedEmployeeId && String(asset.assignedEmployeeId) === String(emp._id))

    // An employee still onboarding cannot open the asset page (middleware sends every
    // other page to /admin/profile), so a holder falls through to My Assets instead.
    if (canDoAny(session, DETAIL_PERMS) && !session.user?.needsOnboarding) {
      return NextResponse.json({ data: { ...base, canView: true, mine } })
    }
    if (mine) return NextResponse.json({ data: { ...base, canView: false, mine: true } })

    return NextResponse.json({ error: 'This asset is not assigned to you' }, { status: 403 })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/assets/tag/[tag]]')
  }
}
