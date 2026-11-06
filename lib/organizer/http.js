/**
 * lib/organizer/http.js — shared request helpers for /api/organizer/* routes.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, requireStaff } from '@/lib/rbac'

export const VIEW   = 'organizer.view'
export const MANAGE = 'organizer.manage'

/** Error with an HTTP status, thrown by helpers and mapped by handleError(). */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

/** 422 shaped like a zod failure, so clients surface the field's message. */
export function fieldError(field, message) {
  return new HttpError(422, 'Validation failed', { formErrors: [], fieldErrors: { [field]: [message] } })
}

export function jsonError(message, status, details) {
  return NextResponse.json(details ? { error: message, details } : { error: message }, { status })
}

/**
 * Session + permission gate (staff only).
 *   const { session, denied } = await authorize(VIEW); if (denied) return denied
 */
export async function authorize(perm) {
  const session = await getServerSession(authOptions)
  if (!session) return { denied: jsonError('Unauthorised', 401) }
  const denied = requireStaff(session) ?? requirePerm(session, perm)
  if (denied) return { denied }
  return { session }
}

/** 422 for a failed zod safeParse. */
export function validationFailed(zodError) {
  return jsonError('Validation failed', 422, zodError.flatten())
}

/** Parsed JSON body, or undefined when missing / not JSON. */
export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/** Map a thrown error to the house JSON error shape. */
export function handleError(err, tag) {
  const status = Number(err?.status)
  if (status >= 400 && status < 500) return jsonError(err.message || 'Request failed', status, err.details)
  if (err?.name === 'ValidationError') {
    const first = err.errors ? Object.values(err.errors)[0]?.message : null
    return jsonError(first || 'Validation failed', 422)
  }
  if (err?.name === 'CastError') return jsonError(`Invalid value for ${err.path || 'a field'}`, 400)
  console.error(tag, err)
  return jsonError('Internal server error', 500)
}

/** Fields of the acting user for logActivity(). */
export function actor(session, request) {
  return { userId: session.user.id, userRole: session.user.role, request }
}
