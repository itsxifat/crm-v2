export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { RevisionError, decideRevision } from '@/lib/hr/salaryRevisions'
import { z } from 'zod'

const bodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  ids:    z.array(z.string().refine(isValidObjectId)).min(1).max(200),
  note:   z.string().trim().max(1000).optional().nullable(),
})

// POST /api/salary-revisions/decide — { action: 'approve'|'reject', ids, note? }
// Approves or rejects several proposals (an appraisal round); each one on its own.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.salary.approve')
    if (denied) return denied
    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return NextResponse.json({ error: 'Choose the changes to approve or reject' }, { status: 422 })
    await connectDB()

    const done = []
    const failed = []
    const warnings = []
    for (const id of [...new Set(parsed.data.ids)]) {
      try {
        const r = await decideRevision({ id, action: parsed.data.action, note: parsed.data.note, session })
        done.push(String(r.revision._id))
        warnings.push(...r.warnings)
      } catch (err) {
        if (!(err instanceof RevisionError)) throw err
        failed.push({ id, error: err.message })
      }
    }
    if (done.length) {
      logActivity({
        userId: session.user.id, userRole: session.user.role,
        action: parsed.data.action === 'approve' ? 'APPROVE' : 'REJECT',
        entity: 'SALARY_REVISION', entityId: done[0],
        changes: JSON.stringify({ ids: done, note: parsed.data.note ?? null }),
        request,
      })
    }
    return NextResponse.json({ done, failed, warnings }, { status: done.length ? 200 : 422 })
  } catch (err) {
    console.error('[POST /api/salary-revisions/decide]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
