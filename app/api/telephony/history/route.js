export const dynamic = 'force-dynamic'
import { callHistory } from '@/lib/telephony/envo'
import { numberKey } from '@/lib/telephony/numbers'
import { phoneRoute, json, fail } from '@/lib/telephony/route'

// Every open caller panel asks for the same number at once: answer them from one Envo call.
const TTL_MS = 20_000
const cache = globalThis.__envoCallHistory ?? (globalThis.__envoCallHistory = new Map())

// GET /api/telephony/history?number=… — the last calls with this number on the office's
// SIP server (anyone's), from Envo's call records.
export async function GET(request) {
  return phoneRoute('GET /api/telephony/history', async ({ access }) => {
    const key = numberKey(new URL(request.url).searchParams.get('number'))
    if (key.length < 3) return fail('Give a phone number', 422)

    const cacheKey = `${access.settings.baseUrl}|${key}`
    let hit = cache.get(cacheKey)
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const r = await callHistory(access.settings, { search: key, limit: 6 })
      hit = { at: Date.now(), calls: Array.isArray(r?.calls) ? r.calls : [], total: Number(r?.total) || 0 }
      cache.set(cacheKey, hit)
      if (cache.size > 300) cache.delete(cache.keys().next().value)
    }
    const mine = access.extension
    return json({
      data: {
        total: hit.total,
        calls: hit.calls.map(c => ({
          id: c.id,
          startedAt: c.startedAt,
          direction: c.direction ?? null,
          from: c.from ?? null,
          fromName: c.fromName ?? null,
          to: c.to ?? null,
          answered: !!c.answered,
          talkSec: Number(c.talkSec) || 0,
          mine: !!mine && (c.from === mine || c.to === mine),
        })),
      },
    })
  })
}
