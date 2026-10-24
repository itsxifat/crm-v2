export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPaySettings, getEncloudSettings, keyMode, SECRET_MASK } from '@/lib/integrations/settings'
import { checkKey } from '@/lib/enfinitoPay'
import { encloud } from '@/lib/encloud/client'
import { z } from 'zod'

const bodySchema = z.object({
  target:    z.enum(['pay', 'encloud']),
  secretKey: z.string().trim().max(500).optional(),   // pay: an unsaved key to try
  apiKey:    z.string().trim().max(500).optional(),   // encloud: an unsaved key to try
  baseUrl:   z.string().trim().max(300).optional(),
})

// POST /api/settings/integrations/test — { target } tries the key (the one typed,
// or the saved one) without touching any payment or file.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 422 })
    const d = parsed.data
    const typed = (v) => v && v !== SECRET_MASK

    if (d.target === 'pay') {
      const key = typed(d.secretKey) ? d.secretKey : (await getPaySettings()).secretKey
      if (!key) return NextResponse.json({ ok: false, message: 'Enter the secret key first' })
      const r = await checkKey(key)
      return NextResponse.json({ ...r, mode: keyMode(key) })
    }

    const saved = await getEncloudSettings()
    const settings = {
      ...saved,
      enabled: true,
      baseUrl: d.baseUrl || saved.baseUrl,
      apiKey:  typed(d.apiKey) ? d.apiKey : saved.apiKey,
    }
    if (!settings.apiKey) return NextResponse.json({ ok: false, message: 'Enter the API key first' })
    try {
      const r = await encloud.ping({ settings })
      const scopes = Array.isArray(r.scopes) ? r.scopes : []
      if (!scopes.includes('write')) {
        return NextResponse.json({ ok: false, message: `Connected to ${r.company || 'encloud'}, but the key "${r.key}" is read-only: make a key that can change things` })
      }
      return NextResponse.json({ ok: true, message: `Connected to ${r.company || 'encloud'} with the key "${r.key}"` })
    } catch (err) {
      const msg = err?.status === 401 ? 'encloud refused this API key (wrong or revoked)'
        : err?.status === 403 ? `encloud refused this server's address: ${err.message.replace(/^encloud: /, '')}`
        : err?.message || 'Could not reach encloud'
      return NextResponse.json({ ok: false, message: msg })
    }
  } catch (err) {
    console.error('[POST /api/settings/integrations/test]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
