export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { readFile } from 'fs/promises'
import { authOptions } from '@/lib/auth'
import { resolveUploadPaths, UPLOAD_CONTENT_TYPES } from '@/lib/uploads'

// GET /uploads/<bucket>/<uuid>.<ext> — serves user uploads (stored outside
// public/) to signed-in users only, with a fixed Content-Type derived from the
// whitelisted extension and a sandboxing CSP so a file can never run script.
export async function GET(request, { params }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const resolved = resolveUploadPaths(params.path)
  if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let data = null
  for (const p of resolved.paths) {
    try {
      data = await readFile(p)
      break
    } catch {
      // try the next location
    }
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const headers = {
    'Content-Type':           UPLOAD_CONTENT_TYPES[resolved.ext],
    'Content-Length':         String(data.length),
    'Content-Disposition':    'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control':          'private, max-age=3600',
  }
  // Images: lock the document down completely. (Chrome's PDF viewer refuses to
  // render under a `sandbox` CSP, so PDFs rely on the fixed Content-Type.)
  if (resolved.ext !== 'pdf') {
    headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
  }

  return new NextResponse(data, { status: 200, headers })
}
