export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Document, Project, Client, Freelancer, Vendor } from '@/models'
import { requireStaff, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { ciContains } from '@/lib/searchMatch'

// Only this app's own upload paths or plain http(s) links may be stored — no
// javascript:/data: URLs that would execute when rendered as <a href>.
function isSafeFileUrl(url) {
  if (typeof url !== 'string') return false
  const u = url.trim()
  if (u.startsWith('/uploads/') && !u.includes('..')) return true
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

// GET /api/documents — admin document library. External portals use their own
// scoped endpoints (e.g. /api/client/documents), so this is staff-only.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit') ?? '20', 10)
    const category  = searchParams.get('category')
    const search    = searchParams.get('search')
    const clientId  = searchParams.get('clientId')
    const projectId = searchParams.get('projectId')
    const skip      = (page - 1) * limit

    const filter = {}
    if (category)  filter.category  = category
    if (clientId)  {
      if (!isValidObjectId(clientId)) return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
      filter.clientId = clientId
    }
    if (projectId) {
      if (!isValidObjectId(projectId)) return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
      filter.projectId = projectId
    }
    if (search)    filter.name      = ciContains(search)

    const [documents, total] = await Promise.all([
      Document.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        // Display fields only — never bank / KYC / salary / inviteToken data.
        .populate({ path: 'clientId',     select: 'company clientCode userId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'projectId', select: 'id name' })
        .populate({ path: 'freelancerId', select: 'type agencyInfo.agencyName userId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'vendorId', select: 'id company' }),
      Document.countDocuments(filter),
    ])

    return NextResponse.json({
      data: documents,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/documents — staff with project edit rights only. Documents linked
// to a project are shown to that project's client as deliverables.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session) || requirePerm(session, 'projects.update')
    if (denied) return denied

    await connectDB()

    const body = await request.json()
    const { name, description, fileUrl, fileSize, mimeType, category, projectId, clientId, freelancerId, vendorId } = body

    if (!name || !fileUrl) {
      return NextResponse.json({ error: 'name and fileUrl are required' }, { status: 422 })
    }
    if (!isSafeFileUrl(fileUrl)) {
      return NextResponse.json({ error: 'fileUrl must be an uploaded file or an http(s) URL' }, { status: 422 })
    }

    // Referenced records must be valid ids that actually exist.
    const refs = [
      ['projectId', projectId, Project],
      ['clientId', clientId, Client],
      ['freelancerId', freelancerId, Freelancer],
      ['vendorId', vendorId, Vendor],
    ]
    for (const [field, id, Model] of refs) {
      if (!id) continue
      if (!isValidObjectId(id) || !(await Model.exists({ _id: id }))) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 })
      }
    }

    const doc = await new Document({
      name,
      description,
      fileUrl: fileUrl.trim(),
      fileSize,
      mimeType,
      category,
      projectId:    projectId    || null,
      clientId:     clientId     || null,
      freelancerId: freelancerId || null,
      vendorId:     vendorId     || null,
      uploadedBy:   session.user.id,
    }).save()

    return NextResponse.json({ data: doc }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/documents]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
