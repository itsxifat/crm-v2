export const dynamic = 'force-dynamic'
import { z } from 'zod'
import { originate } from '@/lib/telephony/envo'
import { resolveTarget } from '@/lib/telephony/lookup'
import { dialable } from '@/lib/telephony/numbers'
import { phoneRoute, json, fail } from '@/lib/telephony/route'
import { logActivity } from '@/lib/logActivity'
import { hit } from '@/lib/rateLimit'

const bodySchema = z.object({
  to:     z.string().trim().max(40).optional(),
  target: z.object({
    type:  z.enum(['client', 'lead']),
    id:    z.string().trim().min(1).max(64),
    field: z.string().trim().min(1).max(32),
  }).strict().optional(),
}).strict().refine(b => !!b.to !== !!b.target, 'Give either a number or a record to call')

// POST /api/telephony/originate — { to } or { target }: "ring my phone first". Envo rings
// every phone on the person's extension (desk phone, apps, browser), and dials the
// number once they pick up. For people who would rather talk on their desk phone.
export async function POST(request) {
  return phoneRoute('POST /api/telephony/originate', async ({ session, access }) => {
    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid request', 422)
    const rl = hit(`phone-originate:${session.user.id}`, 20, 60_000)
    if (!rl.ok) return fail('Too many calls in a minute; wait a moment', 429)

    let to = parsed.data.to ? dialable(parsed.data.to) : null
    let display = to
    if (parsed.data.target) {
      const found = await resolveTarget(session, parsed.data.target)
      if (!found) return fail('There is no number to call there', 404)
      to = found.number
      display = found.display
    }
    if (!to || !/^\+?[0-9*#]{1,32}$/.test(to)) return fail('That is not a number Envo can dial', 422)

    await originate(access.settings, { extension: access.extension, to })
    const t = parsed.data.target
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'CALL',
      entity: t ? (t.type === 'client' ? 'CLIENT' : 'LEAD') : 'PHONE', entityId: t?.id ?? null,
      changes: JSON.stringify({ via: 'ring-my-phone', extension: access.extension, ...(t ? { field: t.field } : {}) }), request,
    })
    return json({ data: { ok: true, extension: access.extension, display } }, 202)
  })
}
