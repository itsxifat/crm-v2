// Server-only: compose attachments uploaded before sending.
// Errors are thrown as Error with `.status` (400/403/404/422) + a human message; routes return `err.status ?? 500`.
//
// Layout: storage/uploads/mail/<userId>/<uuid> (bytes) + <uuid>.json (meta).
// Uploads are scoped to the uploader, so a user can only attach their own files.
// They are never served back to the browser, only embedded into outgoing MIME.
import path from 'path'
import { randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from 'fs/promises'
import { MAIL_LIMITS } from '@/lib/mail/constants'

export const MAIL_UPLOAD_ROOT = path.join(process.cwd(), 'storage', 'uploads', 'mail')

const ID_RE = /^[a-f0-9-]{36}$/
const USER_RE = /^[a-f0-9]{24}$/i
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function mailError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function userDir(userId) {
  const uid = String(userId ?? '')
  if (!USER_RE.test(uid)) return null
  return path.join(MAIL_UPLOAD_ROOT, uid.toLowerCase())
}

// Both checks are needed: the regex rejects traversal outright, the prefix check
// guards against any future change to how ids are built.
function filePaths(userId, id) {
  const dir = userDir(userId)
  if (!dir || !ID_RE.test(String(id ?? ''))) return null
  const file = path.join(dir, id)
  if (!file.startsWith(dir + path.sep)) return null
  return { dir, file, meta: `${file}.json` }
}

/** Filename safe for a MIME header: no path parts, no control chars, ≤ 200 chars (extension kept). */
export function sanitizeFilename(name) {
  let s = String(name ?? '').normalize('NFC')
  s = s.split(/[\\/]/).pop()
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]/g, '').replace(/^[.\s]+/, '').trim()
  if (s.length > 200) {
    const ext = path.extname(s).slice(0, 20)
    s = s.slice(0, 200 - ext.length).trim() + ext
  }
  return s || 'attachment'
}

function sanitizeContentType(type) {
  const t = String(type ?? '').split(';')[0].trim().toLowerCase()
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(t)
    ? t
    : 'application/octet-stream'
}

function formatMb(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/**
 * Store an uploaded File (from request.formData()).
 * @returns {Promise<{ id: string, filename: string, size: number, contentType: string }>}
 */
export async function saveMailUpload(userId, file) {
  const dir = userDir(userId)
  if (!dir) throw mailError(403, 'Forbidden')
  if (!file || typeof file.arrayBuffer !== 'function') throw mailError(400, 'No file uploaded')
  if (file.size > MAIL_LIMITS.attachmentBytes) {
    throw mailError(422, `File too large (max ${formatMb(MAIL_LIMITS.attachmentBytes)})`)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!buffer.length) throw mailError(422, 'File is empty')
  if (buffer.length > MAIL_LIMITS.attachmentBytes) {
    throw mailError(422, `File too large (max ${formatMb(MAIL_LIMITS.attachmentBytes)})`)
  }

  const id = randomUUID()
  const meta = {
    filename: sanitizeFilename(file.name),
    contentType: sanitizeContentType(file.type),
    size: buffer.length,
    createdAt: new Date().toISOString(),
  }
  const paths = filePaths(userId, id)
  await mkdir(dir, { recursive: true })
  await writeFile(paths.file, buffer)
  // Meta last: a reader that finds the meta can rely on the bytes being there.
  await writeFile(paths.meta, JSON.stringify(meta))

  return { id, filename: meta.filename, size: meta.size, contentType: meta.contentType }
}

async function readMeta(paths) {
  try {
    return JSON.parse(await readFile(paths.meta, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return null
    throw err
  }
}

/** Upload metadata without reading the bytes → { id, filename, contentType, size, createdAt } | null */
export async function statMailUpload(userId, id) {
  const paths = filePaths(userId, id)
  if (!paths) return null
  const meta = await readMeta(paths)
  if (!meta) return null
  try {
    const st = await stat(paths.file)
    return {
      id,
      filename: sanitizeFilename(meta.filename),
      contentType: sanitizeContentType(meta.contentType),
      size: st.size,
      createdAt: meta.createdAt ? new Date(meta.createdAt) : st.mtime,
    }
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/** → { buffer, filename, contentType, size } | null */
export async function readMailUpload(userId, id) {
  const paths = filePaths(userId, id)
  if (!paths) return null
  const meta = await readMeta(paths)
  if (!meta) return null
  try {
    const buffer = await readFile(paths.file)
    return {
      buffer,
      filename: sanitizeFilename(meta.filename),
      contentType: sanitizeContentType(meta.contentType),
      size: buffer.length,
    }
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function unlinkQuiet(p) {
  try {
    await unlink(p)
    return true
  } catch {
    return false
  }
}

/**
 * Delete uploads older than 7 days (kept that long so undo-send / scheduled
 * sends / reopened drafts can still resolve them). Called hourly by the worker.
 * @returns {Promise<{ removed: number }>}
 */
export async function cleanupOldUploads() {
  let removed = 0
  let users
  try {
    users = await readdir(MAIL_UPLOAD_ROOT, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return { removed }
    throw err
  }

  const cutoff = Date.now() - MAX_AGE_MS
  for (const entry of users) {
    if (!entry.isDirectory() || !USER_RE.test(entry.name)) continue
    const dir = path.join(MAIL_UPLOAD_ROOT, entry.name)
    let names
    try {
      names = await readdir(dir)
    } catch {
      continue
    }

    const ids = new Set(names.map(n => n.replace(/\.json$/, '')).filter(n => ID_RE.test(n)))
    for (const id of ids) {
      const file = path.join(dir, id)
      const metaFile = `${file}.json`
      let createdAt = null
      try {
        const meta = JSON.parse(await readFile(metaFile, 'utf8'))
        createdAt = meta.createdAt ? new Date(meta.createdAt).getTime() : null
      } catch { /* orphan bytes or broken meta: fall back to mtime */ }
      if (createdAt == null || Number.isNaN(createdAt)) {
        try {
          createdAt = (await stat(names.includes(id) ? file : metaFile)).mtimeMs
        } catch {
          continue
        }
      }
      if (createdAt >= cutoff) continue
      const a = await unlinkQuiet(file)
      const b = await unlinkQuiet(metaFile)
      if (a || b) removed++
    }

    try {
      if (!(await readdir(dir)).length) await rmdir(dir)
    } catch { /* not empty / raced with a new upload */ }
  }
  return { removed }
}
