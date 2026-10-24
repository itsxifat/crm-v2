export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { RevisionError, decideRevision, revisionJson, usersOf } from '@/lib/hr/salaryRevisions'
import { z } from 'zod'

const bodySchema = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
  note:   z.string().trim().max(1000).optional().nullable(),
})

// PATCH /api/salary-revisions/:id — { action: 'approve'|'reject'|'cancel', note? }
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return NextResponse.json({ error: 'Choose approve, reject or cancel' }, { status: 422 })
    await connectDB()

    let result
    try {
      result = await decideRevision({ id: params.id, action: parsed.data.action, note: parsed.data.note, session })
    } catch (err) {
      if (err instanceof RevisionError) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }
    const r = result.revision
    logActivity({
      userId: session.user.id, userRole: session.user.role,
      action: parsed.data.action === 'approve' ? 'APPROVE' : parsed.data.action === 'reject' ? 'REJECT' : 'CANCEL',
      entity: 'SALARY_REVISION', entityId: String(r._id),
      changes: JSON.stringify({ employeeId: String(r.employeeId), type: r.type, from: r.previousSalary, to: r.newSalary, effectiveMonth: r.effectiveMonth, status: r.status, note: parsed.data.note ?? null }),
      request,
    })
    return NextResponse.json({ data: revisionJson(r, { users: await usersOf([r]) }), warnings: result.warnings })
  } catch (err) {
    console.error('[PATCH /api/salary-revisions/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
