export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { phoneAccess } from '@/lib/telephony/access'
import { json, fail } from '@/lib/telephony/route'

// GET /api/telephony/me — can this person call, and from which extension. The phone
// stays hidden for everyone without one, so people who never call see nothing new.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const access = await phoneAccess(session)
    return json({
      data: access.ok
        ? { enabled: true, extension: access.extension, userId: session.user.id }
        : { enabled: false, reason: access.reason },
    })
  } catch (err) {
    console.error('[GET /api/telephony/me]', err)
    return fail('Internal server error', 500)
  }
}
