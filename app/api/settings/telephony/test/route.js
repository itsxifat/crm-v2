export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { getPhoneSettings, SECRET_MASK } from '@/lib/integrations/settings'
import { ping, API_KEY_RE } from '@/lib/telephony/envo'

const bodySchema = z.object({
  baseUrl: z.string().trim().max(300).optional(),
  apiKey:  z.string().trim().max(300).optional(),   // an unsaved key to try
}).strict()

const NEEDED = ['read', 'calls', 'webphone']

// POST /api/settings/telephony/test — tries the key (the one typed, or the saved one).
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 422 })

    const saved = await getPhoneSettings()
    const typed = parsed.data.apiKey && parsed.data.apiKey !== SECRET_MASK ? parsed.data.apiKey : null
    let baseUrl = saved.baseUrl
    if (parsed.data.baseUrl) {
      try { baseUrl = new URL(parsed.data.baseUrl).origin } catch { return NextResponse.json({ ok: false, message: 'Enter Envo’s address, e.g. https://envo.enfinito.cloud' }) }
    }
    const apiKey = typed ?? saved.apiKey
    if (!apiKey) return NextResponse.json({ ok: false, message: 'Enter the API key first' })
    if (!API_KEY_RE.test(apiKey)) return NextResponse.json({ ok: false, message: 'The API key looks like envo_live_… (Envo → Integrations → API keys)' })

    try {
      const r = await ping({ baseUrl, apiKey })
      const scopes = Array.isArray(r.scopes) ? r.scopes : []
      const missing = NEEDED.filter(s => !scopes.includes(s))
      const server = r.sipServer?.name ? `the SIP server “${r.sipServer.name}”` : 'Envo'
      if (missing.length) {
        return NextResponse.json({ ok: false, message: `Connected to ${server}, but the key “${r.key}” lacks: ${missing.join(', ')}. Give it Read, Calls and Web phone.` })
      }
      return NextResponse.json({ ok: true, message: `Connected to ${server} with the key “${r.key}”` })
    } catch (err) {
      return NextResponse.json({ ok: false, message: err?.message || 'Could not reach Envo' })
    }
  } catch (err) {
    console.error('[POST /api/settings/telephony/test]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
