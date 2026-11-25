export const dynamic = 'force-dynamic'
import { identify } from '@/lib/telephony/lookup'
import { digitsOf } from '@/lib/telephony/numbers'
import { phoneRoute, json, fail } from '@/lib/telephony/route'

// GET /api/telephony/lookup?number=… — who is calling (or being called): the clients,
// leads and colleagues behind the number, with what the caller panel shows about them.
export async function GET(request) {
  return phoneRoute('GET /api/telephony/lookup', async ({ session, access }) => {
    const number = new URL(request.url).searchParams.get('number')?.trim() ?? ''
    if (!digitsOf(number) || number.length > 40) return fail('Give a phone number', 422)
    const matches = await identify(session, number, access.settings)
    return json({ data: { number, matches } })
  })
}
