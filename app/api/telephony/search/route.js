export const dynamic = 'force-dynamic'
import { searchContacts } from '@/lib/telephony/lookup'
import { phoneRoute, json } from '@/lib/telephony/route'

// GET /api/telephony/search?q=… — the dialpad's contacts: clients, leads and colleagues
// by name or by part of their number.
export async function GET(request) {
  return phoneRoute('GET /api/telephony/search', async ({ session, access }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 60)
    return json({ data: await searchContacts(session, q, access.settings) })
  })
}
