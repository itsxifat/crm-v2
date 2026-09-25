/**
 * lib/uploads.js — shared helpers for user file uploads.
 *
 * Files are stored OUTSIDE public/ (storage/uploads/<bucket>/<uuid>.<ext>) and
 * served by the authenticated route app/uploads/[...path]/route.js, so:
 *   • the stored extension / Content-Type are derived from the file's magic
 *     bytes, never from the client-supplied file name or MIME type (no .svg/.html
 *     uploads that would run script on this origin);
 *   • files uploaded after `next start` are servable immediately (Next only
 *     indexes public/ at boot);
 *   • URLs keep the historical shape /uploads/<bucket>/<file>.
 */
import path from 'path'
import { writeFile, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'

export const UPLOAD_ROOT        = path.join(process.cwd(), 'storage', 'uploads')
// Files uploaded before storage moved out of public/ still live here.
export const LEGACY_UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads')

export const UPLOAD_BUCKETS = ['receipts', 'onboarding']

// ext → Content-Type for everything we accept and serve.
export const UPLOAD_CONTENT_TYPES = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg', // legacy uploads kept the client's extension
  png:  'image/png',
  webp: 'image/webp',
  pdf:  'application/pdf',
}

/**
 * Detect the real file type from its leading bytes.
 * @param {Buffer} buf
 * @returns {{ mime: string, ext: string } | null}
 */
export function sniffFileType(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' }
  }
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  return null
}

/**
 * Validate and store an uploaded File. Returns { url } or { error, status }.
 * @param {File} file
 * @param {{ bucket: string, maxSize: number }} opts
 */
export async function saveUpload(file, { bucket, maxSize }) {
  if (!UPLOAD_BUCKETS.includes(bucket)) throw new Error(`Unknown upload bucket: ${bucket}`)

  if (file.size > maxSize) {
    return { error: `File too large (max ${Math.round(maxSize / (1024 * 1024))} MB)`, status: 422 }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const kind   = sniffFileType(buffer)
  if (!kind) {
    return { error: 'Only JPG, PNG, WebP or PDF allowed', status: 422 }
  }

  const filename = `${randomUUID()}.${kind.ext}`
  const dir      = path.join(UPLOAD_ROOT, bucket)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, filename), buffer)

  return { url: `/uploads/${bucket}/${filename}` }
}

// <uuid>.<ext> with an accepted extension — anything else is rejected before
// touching the filesystem (no traversal, no legacy .svg/.html files).
const SAFE_NAME = /^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|pdf)$/i

/**
 * Map /uploads/<bucket>/<name> segments to candidate absolute paths.
 * @param {string[]} segments
 * @returns {{ paths: string[], ext: string } | null}
 */
export function resolveUploadPaths(segments) {
  if (!Array.isArray(segments) || segments.length !== 2) return null
  const [bucket, name] = segments
  if (!UPLOAD_BUCKETS.includes(bucket)) return null
  const m = SAFE_NAME.exec(name)
  if (!m) return null
  return {
    paths: [path.join(UPLOAD_ROOT, bucket, name), path.join(LEGACY_UPLOAD_ROOT, bucket, name)],
    ext:   m[1].toLowerCase(),
  }
}
