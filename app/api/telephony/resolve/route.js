export const dynamic = 'force-dynamic'
import { z } from 'zod'
import { resolveTarget } from '@/lib/telephony/lookup'
import { phoneRoute, json, fail } from '@/lib/telephony/route'
import { logActivity } from '@/lib/logActivity'

const bodySchema = z.object({
  type:  z.enum(['client', 'lead']),
  id:    z.string().trim().min(1).max(64),
  field: z.string().trim().min(1).max(32),
}).strict()

// POST /api/telephony/resolve — { type, id, field } → the number a call button dials.
// Call buttons name the record, not the number, so they work where the number is
// shown masked; every call placed this way is in the activity log.
export async function POST(request) {
  return phoneRoute('POST /api/telephony/resolve', async ({ session, access }) => {
    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return fail('Invalid request', 422)
    const target = parsed.data
    const found = await resolveTarget(session, target)
    if (!found) return fail('There is no number to call there', 404)
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'CALL',
      entity: target.type === 'client' ? 'CLIENT' : 'LEAD', entityId: target.id,
      changes: JSON.stringify({ field: target.field, extension: access.extension }), request,
    })
    return json({ data: found })
  })
}
