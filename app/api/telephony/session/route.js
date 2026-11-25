export const dynamic = 'force-dynamic'
import { cachedWebPhoneSession } from '@/lib/telephony/envo'
import { phoneWsAllowed, phoneWsOrigins } from '@/lib/telephony/csp'
import { phoneRoute, json, fail } from '@/lib/telephony/route'
import { hit } from '@/lib/rateLimit'

// POST /api/telephony/session — SIP credentials for the signed-in person's own extension,
// so their browser can register with Envo. The token is minted and exchanged here: the
// API key never reaches the browser.
export async function POST() {
  return phoneRoute('POST /api/telephony/session', async ({ session, access }) => {
    const rl = hit(`phone-session:${session.user.id}`, 30, 10 * 60_000)
    if (!rl.ok) return fail('Too many phone restarts; try again in a few minutes', 429)

    const s = await cachedWebPhoneSession(access.settings, session.user.id, access.extension)
    if (!phoneWsAllowed(s.wsUrl)) {
      return fail(
        `Envo's phone server is ${new URL(s.wsUrl).origin}, which this CRM's security policy does not allow ` +
        `(allowed: ${phoneWsOrigins().join(', ') || 'none'}). Set ENVO_PHONE_WS on the CRM server and restart it.`,
        409,
      )
    }
    return json({
      data: {
        wsUrl: s.wsUrl,
        domain: s.domain,
        username: s.username,
        password: s.password,
        displayName: s.displayName || session.user.name,
        extension: s.extension || access.extension,
        sipServer: s.sipServer ?? null,
        iceServers: Array.isArray(s.iceServers) ? s.iceServers : [],
      },
    })
  })
}
