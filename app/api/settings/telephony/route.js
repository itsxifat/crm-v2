export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { getPhoneSettings, savePhoneSettings, maskPhoneSettings, SECRET_MASK } from '@/lib/integrations/settings'
import { ping, listExtensions, forgetWebPhoneSessions, API_KEY_RE } from '@/lib/telephony/envo'
import { STAFF_ROLES } from '@/lib/telephony/access'
import { phoneWsOrigins } from '@/lib/telephony/csp'

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status })
const superAdminOnly = (session) => (!session || session.user.role !== 'SUPER_ADMIN') ? fail('Forbidden', 403) : null
const given = (v) => v !== undefined && v !== SECRET_MASK

const EXT_RE = /^[0-9]{2,8}$/

async function payload() {
  await connectDB()
  const s = await getPhoneSettings()
  const assigned = Object.keys(s.extensions ?? {}).filter(isValidObjectId)
  const users = await User.find({ $or: [{ role: { $in: STAFF_ROLES }, isActive: true }, { _id: { $in: assigned } }] })
    .select('name email role isActive').sort({ name: 1 }).lean()
  const emps = await Employee.find({ userId: { $in: users.map(u => u._id) } }).select('userId designation').lean()
  const designation = new Map(emps.map(e => [String(e.userId), e.designation]))

  // What Envo says right now: whose key it is, and its extensions with presence.
  let envo = null
  if (s.baseUrl && s.apiKey) {
    try {
      const [p, extensions] = await Promise.all([ping(s), listExtensions(s)])
      envo = { ok: true, sipServer: p.sipServer ?? null, key: p.key ?? null, scopes: p.scopes ?? [], extensions: Array.isArray(extensions) ? extensions : [] }
    } catch (err) {
      envo = { ok: false, error: err.message }
    }
  }
  return {
    settings: maskPhoneSettings(s),
    staff: users.map(u => ({
      id: String(u._id), name: u.name, email: u.email, role: u.role, isActive: u.isActive !== false,
      designation: designation.get(String(u._id)) ?? null,
    })),
    envo,
    wsOrigins: phoneWsOrigins(),
    canSaveSecrets: (process.env.ENCRYPTION_MASTER_KEY ?? '').length >= 64,
  }
}

// GET /api/settings/telephony — calling settings (key masked), staff, and Envo's extensions.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = superAdminOnly(session)
    if (denied) return denied
    return NextResponse.json({ data: await payload() })
  } catch (err) {
    console.error('[GET /api/settings/telephony]', err)
    return fail('Internal server error', 500)
  }
}

const bodySchema = z.object({
  enabled:    z.boolean().optional(),
  baseUrl:    z.string().trim().max(300).optional(),
  apiKey:     z.string().trim().max(300).optional(),
  // userId → extension; '' takes the extension away.
  extensions: z.record(z.string().max(64), z.string().trim().max(8)).optional(),
}).strict()

// PUT /api/settings/telephony — { enabled?, baseUrl?, apiKey?, extensions? }. The key sent
// as the mask keeps the saved one; '' removes it. `extensions` replaces the whole list.
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = superAdminOnly(session)
    if (denied) return denied
    await connectDB()

    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return fail('Some settings are not valid', 422, { details: parsed.error.flatten() })
    const patch = { ...parsed.data }
    const current = await getPhoneSettings()

    if (patch.baseUrl !== undefined) {
      let u = null
      try { u = new URL(patch.baseUrl) } catch { /* below */ }
      const local = u && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
      if (!u || !(u.protocol === 'https:' || (u.protocol === 'http:' && local))) {
        return fail('Enter Envo’s address, e.g. https://envo.enfinito.cloud', 422, { field: 'baseUrl' })
      }
      patch.baseUrl = u.origin
    }
    if (given(patch.apiKey) && patch.apiKey) {
      if (!API_KEY_RE.test(patch.apiKey)) {
        return fail('The API key looks like envo_live_… (Envo → Integrations → API keys)', 422, { field: 'apiKey' })
      }
      if ((process.env.ENCRYPTION_MASTER_KEY ?? '').length < 64) {
        return fail('Keys are stored encrypted: set ENCRYPTION_MASTER_KEY on the server first', 409)
      }
    }
    const nextKey = given(patch.apiKey) ? patch.apiKey : current.apiKey
    if ((patch.enabled ?? current.enabled) && !nextKey) return fail('Add the API key before turning calling on', 422, { field: 'apiKey' })

    if (patch.extensions) {
      const out = {}
      for (const [userId, ext] of Object.entries(patch.extensions)) {
        if (!ext) continue
        if (!isValidObjectId(userId)) return fail('Unknown staff member', 422, { field: 'extensions' })
        if (!EXT_RE.test(ext)) return fail(`“${ext}” is not an extension number (2–8 digits)`, 422, { field: 'extensions', userId })
        out[userId] = ext
      }
      const ids = Object.keys(out)
      if (ids.length) {
        const staff = await User.find({ _id: { $in: ids } }).select('role isActive').lean()
        const known = new Map(staff.map(u => [String(u._id), u]))
        for (const id of ids) {
          const u = known.get(id)
          const wasAssigned = String(current.extensions?.[id] ?? '') === out[id]
          if (!u || !STAFF_ROLES.includes(u.role)) return fail('Only staff can be given an extension', 422, { field: 'extensions', userId: id })
          if (u.isActive === false && !wasAssigned) return fail('That account is deactivated', 422, { field: 'extensions', userId: id })
        }
      }
      patch.extensions = out
    }

    await savePhoneSettings(patch)
    forgetWebPhoneSessions()

    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'UPDATE', entity: 'SETTINGS', entityId: 'telephony',
      changes: JSON.stringify({
        ...patch,
        apiKey: given(patch.apiKey) ? (patch.apiKey ? 'changed' : 'cleared') : 'kept',
      }),
      request,
    })
    return NextResponse.json({ data: await payload() })
  } catch (err) {
    console.error('[PUT /api/settings/telephony]', err)
    return fail('Internal server error', 500)
  }
}
