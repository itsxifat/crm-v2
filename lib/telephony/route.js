/**
 * lib/telephony/route.js — SERVER-ONLY: what every /api/telephony route does first.
 * Only staff with an Envo extension get past it (lib/telephony/access.js).
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { phoneAccess } from './access'
import { EnvoError } from './envo'

export const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export const fail = (error, status, extra = {}) => json({ error, ...extra }, status)

/** Runs fn({ session, access }) for a person who can call; Envo's failures answer 502 with its reason. */
export async function phoneRoute(label, fn) {
  try {
    const session = await getServerSession(authOptions)
    const access = await phoneAccess(session)
    if (!access.ok) return fail(access.reason, access.status)
    return await fn({ session, access })
  } catch (err) {
    if (err instanceof EnvoError) return fail(err.message, err.status === 503 ? 503 : 502)
    console.error(`[${label}]`, err)
    return fail('Internal server error', 500)
  }
}
