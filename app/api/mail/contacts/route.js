export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser } from '@/lib/mail/access'
import { suggestContacts } from '@/lib/mail/contacts'
import { mailError } from '../_lib/http'

// GET /api/mail/contacts?q=&limit= — recipient autocomplete (mail history + CRM people)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    const q = (sp.get('q') ?? '').trim().slice(0, 100)
    const limit = Math.min(20, Math.max(1, parseInt(sp.get('limit'), 10) || 8))

    await connectDB()
    const rows = await suggestContacts(session, q, limit)
    return NextResponse.json({
      data: (rows || []).map(r => ({ name: r.name || '', address: r.address, source: r.source })),
    })
  } catch (err) {
    return mailError(err, '[GET /api/mail/contacts]')
  }
}
