import { NextResponse } from 'next/server'

/**
 * Map an error from the purchase / stock helpers to a JSON response:
 * `.status` errors (400/403/404/409/422) are returned as-is (with `details`
 * when present), Mongo duplicates as 409, Mongoose validation as 422, the rest
 * as 500 after logging under `label`.
 */
export function errorResponse(err, label) {
  if (err?.status && err.status >= 400 && err.status < 600) {
    const body = { error: err.message || 'Request failed' }
    if (err.details) body.details = err.details
    if (err.code && typeof err.code === 'string') body.code = err.code
    return NextResponse.json(body, { status: err.status })
  }
  if (err?.code === 11000) {
    return NextResponse.json({ error: 'A record with the same unique value already exists' }, { status: 409 })
  }
  if (err?.name === 'ValidationError') {
    const first = Object.values(err.errors ?? {})[0]?.message
    return NextResponse.json({ error: first || 'Validation failed' }, { status: 422 })
  }
  if (err?.name === 'CastError') {
    return NextResponse.json({ error: `Invalid ${err.path ?? 'value'}` }, { status: 422 })
  }
  console.error(label, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** Parse a JSON body; null when the body is missing or not JSON. */
export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}
