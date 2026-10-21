'use client'

import {
  addDays, addYears, differenceInCalendarDays, format, isValid, nextMonday,
  setHours, setMilliseconds, setMinutes, setSeconds,
} from 'date-fns'

export const COMPOSE_MODES = ['new', 'reply', 'replyAll', 'forward', 'draft']

export const QUOTE_STYLE = 'margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex'

const STORAGE_PREFIX = 'mail:composer:'
const RECOVERY_MAX_AGE = 7 * 24 * 3600 * 1000
// A mirror whose window still heartbeats (another tab) must not be recovered here.
const RECOVERY_STALE_MS = 30 * 1000

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ─── Strings / HTML ─────────────────────────────────────────────────────────

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function textToHtml(text) {
  const escaped = escapeHtml(text || '')
  const linked = escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (url) => `<a href="${url}">${url}</a>`)
  return linked.replace(/\r?\n/g, '<br>')
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  const mb = n / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

const DROP_SELECTOR = [
  'script', 'style', 'link', 'meta', 'title', 'base', 'head', 'iframe', 'frame', 'frameset', 'object',
  'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'noscript', 'template', 'svg', 'math',
].join(',')

function parseHtml(html) {
  if (typeof DOMParser === 'undefined') return null
  return new DOMParser().parseFromString(String(html || ''), 'text/html')
}

/**
 * Make (already server-sanitised) mail HTML safe to drop into the editor:
 * <style> blocks and class/id attributes would otherwise restyle the CRM page
 * itself (an email `class="hidden"` matches Tailwind), and fixed positioning
 * could cover the UI.
 */
export function prepareEditorHtml(html) {
  if (!html) return ''
  const doc = parseHtml(html)
  if (!doc) return String(html)
  doc.querySelectorAll(DROP_SELECTOR).forEach((el) => el.remove())
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase()
      if (n === 'class' || n === 'id' || n.startsWith('on') || n === 'contenteditable' || n === 'tabindex' || n === 'autofocus') {
        el.removeAttribute(attr.name)
      } else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*(javascript|vbscript):/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
    const style = el.getAttribute('style')
    if (style && /position\s*:|z-index\s*:/i.test(style)) {
      el.setAttribute('style', style.replace(/(position|z-index)\s*:[^;]*;?/gi, ''))
    }
  })
  return doc.body.innerHTML
}

const PASTE_KEEP = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'BR', 'DIV',
  'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'IMG', 'HR', 'SUB', 'SUP',
])
const PASTE_BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DT', 'DD'])
const SAFE_HREF = /^(https?:|mailto:|tel:)/i

/** Clipboard HTML → basic formatting only (bold/italic/underline/strike, lists, quotes, links, tables). */
export function sanitizePastedHtml(html) {
  const src = parseHtml(html)
  if (!src) return escapeHtml(html)
  src.querySelectorAll(DROP_SELECTOR).forEach((el) => el.remove())
  const out = src.createElement('div')

  const walk = (node, parent) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) { parent.appendChild(src.createTextNode(child.nodeValue)); return }
      if (child.nodeType !== 1) return // comments (Word's <!--[if …]>), etc.
      const tag = child.tagName
      const style = (child.getAttribute('style') || '').toLowerCase()

      if (PASTE_BLOCK.has(tag)) {
        const div = src.createElement('div')
        let target = div
        if (/^H[1-6]$/.test(tag)) { target = src.createElement('b'); div.appendChild(target) }
        parent.appendChild(div)
        walk(child, target)
        return
      }
      if (!PASTE_KEEP.has(tag)) {
        // Inline wrappers (span/font/…): keep children, translate common inline styles.
        let target = parent
        const wrap = (t) => { const el = src.createElement(t); target.appendChild(el); target = el }
        if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) wrap('b')
        if (/font-style\s*:\s*italic/.test(style)) wrap('i')
        if (/text-decoration[^;]*underline/.test(style)) wrap('u')
        if (/text-decoration[^;]*line-through/.test(style)) wrap('s')
        walk(child, target)
        return
      }
      // Google Docs wraps the whole selection in <b style="font-weight:normal">.
      if ((tag === 'B' || tag === 'STRONG') && /font-weight\s*:\s*(normal|[1-4]00)/.test(style)) { walk(child, parent); return }

      const el = src.createElement(tag.toLowerCase())
      if (tag === 'A') {
        const href = (child.getAttribute('href') || '').trim()
        if (SAFE_HREF.test(href)) el.setAttribute('href', href)
      } else if (tag === 'IMG') {
        const s = (child.getAttribute('src') || '').trim()
        if (!/^https?:/i.test(s)) return
        el.setAttribute('src', s)
        const alt = child.getAttribute('alt')
        if (alt) el.setAttribute('alt', alt)
      } else if (tag === 'TD' || tag === 'TH') {
        for (const a of ['colspan', 'rowspan']) {
          if (child.getAttribute(a)) el.setAttribute(a, child.getAttribute(a))
        }
      }
      parent.appendChild(el)
      walk(child, el)
    })
  }

  walk(src.body, out)
  return out.innerHTML
}

export function plainTextToHtml(text) {
  return escapeHtml(text || '').replace(/\r?\n/g, '<br>')
}

/** True when the body has no text/images outside the signature and quoted blocks. */
export function isBlankHtml(html) {
  const doc = parseHtml(html)
  if (!doc) return !String(html || '').replace(/<[^>]*>/g, '').trim()
  doc.querySelectorAll('[data-signature],[data-quote]').forEach((el) => el.remove())
  return !doc.body.textContent.replace(/ /g, ' ').trim() && !doc.body.querySelector('img,table,hr')
}

// ─── Addresses ──────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/

export function isValidAddress(address) {
  return EMAIL_RE.test(String(address || '').trim())
}

/** Split on , ; newline and tab, ignoring separators inside quotes or <…>. */
export function splitAddressList(text) {
  const out = []
  let cur = ''
  let quoted = false
  let angle = false
  for (const ch of String(text || '')) {
    if (ch === '"') quoted = !quoted
    else if (ch === '<' && !quoted) angle = true
    else if (ch === '>' && !quoted) angle = false
    if (!quoted && !angle && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r' || ch === '\t')) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function parseAddress(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^(.*?)<\s*([^<>]*?)\s*>\s*$/)
  let name = ''
  let address = s
  if (m) {
    name = m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim()
    address = m[2]
  }
  address = address.trim().replace(/^mailto:/i, '').replace(/^["']+|["']+$/g, '').trim()
  return { name, address }
}

/** "A <a@x.com>, b@y.com c@z.com" → [{ name, address }] (invalid entries kept so they show as red chips). */
export function parseAddressList(text) {
  const out = []
  for (const token of splitAddressList(text)) {
    if (!token.includes('<') && /\s/.test(token)) {
      const parts = token.split(/\s+/).filter(Boolean)
      if (parts.length > 1 && parts.every(isValidAddress)) {
        parts.forEach((address) => out.push({ name: '', address }))
        continue
      }
    }
    const parsed = parseAddress(token)
    if (parsed.address) out.push(parsed)
  }
  return out
}

const addrKey = (a) => String(a?.address || '').trim().toLowerCase()

export function dedupeAddresses(list, exclude = []) {
  const seen = new Set(exclude.filter(Boolean).map((e) => String(e).trim().toLowerCase()))
  const out = []
  for (const a of list || []) {
    const k = addrKey(a)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push({ name: String(a.name || '').trim(), address: String(a.address).trim() })
  }
  return out
}

export function formatAddress(a) {
  if (!a) return ''
  return a.name ? `${a.name} <${a.address}>` : a.address
}

function addressHtml(a, { boldName = false } = {}) {
  if (!a?.address) return ''
  if (!a.name) return escapeHtml(a.address)
  const name = escapeHtml(a.name)
  return `${boldName ? `<strong>${name}</strong>` : name} &lt;${escapeHtml(a.address)}&gt;`
}

// ─── Subjects / quoting ─────────────────────────────────────────────────────

export function replySubject(subject) {
  const s = String(subject || '').trim()
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`.trim()
}

export function forwardSubject(subject) {
  const s = String(subject || '').trim()
  return /^(fwd?|fw)\s*:/i.test(s) ? s : `Fwd: ${s}`.trim()
}

function quoteDate(value) {
  const d = value ? new Date(value) : null
  return d && isValid(d) ? format(d, "EEE, MMM d, yyyy 'at' h:mm a") : ''
}

function sourceBodyHtml(source) {
  if (source?.html) return prepareEditorHtml(source.html)
  return textToHtml(source?.text || source?.snippet || '')
}

export function buildReplyQuote(source) {
  const date = quoteDate(source?.date)
  const who = addressHtml(source?.from) || 'Unknown sender'
  const line = date ? `On ${escapeHtml(date)}, ${who} wrote:` : `${who} wrote:`
  return `<div><br></div><div data-quote><div>${line}</div><blockquote style="${QUOTE_STYLE}">${sourceBodyHtml(source)}</blockquote></div>`
}

export function buildForwardBlock(source) {
  const list = (arr) => (arr || []).map((a) => addressHtml(a)).filter(Boolean).join(', ')
  const rows = [
    `From: ${addressHtml(source?.from, { boldName: true })}`,
    `Date: ${escapeHtml(quoteDate(source?.date))}`,
    `Subject: ${escapeHtml(source?.subject || '')}`,
    `To: ${list(source?.to)}`,
  ]
  if (source?.cc?.length) rows.push(`Cc: ${list(source.cc)}`)
  return `<div><br></div><div data-quote><div>---------- Forwarded message ---------</div>${rows.map((r) => `<div>${r}</div>`).join('')}<div><br></div>${sourceBodyHtml(source)}</div>`
}

export function signatureHtml(account) {
  const sig = String(account?.signature || '').trim()
  return sig ? prepareEditorHtml(sig) : ''
}

function signatureBlock(account) {
  const sig = signatureHtml(account)
  return sig ? `<div><br></div><div data-signature>${sig}</div>` : ''
}

// ─── Attachments ────────────────────────────────────────────────────────────

/** Payload/source attachment refs → composer chips. */
export function normalizeAttachments(list) {
  const out = []
  for (const a of list || []) {
    if (!a) continue
    if (a.type === 'upload' && a.id) {
      out.push({
        key: uid(), type: 'upload', id: String(a.id),
        filename: a.filename || 'Attachment', size: Number(a.size) || 0,
        contentType: a.contentType || 'application/octet-stream', status: 'done', progress: 1,
      })
    } else if (a.type === 'message' && a.messageId != null && a.idx != null) {
      out.push({
        key: uid(), type: 'message', messageId: String(a.messageId), idx: Number(a.idx),
        filename: a.filename || `Attachment ${Number(a.idx) + 1}`, size: Number(a.size) || 0,
        contentType: a.contentType || 'application/octet-stream', status: 'done', progress: 1,
      })
    }
  }
  return out
}

function messageAttachmentRefs(source) {
  return (source?.attachments || [])
    .filter((a) => !a.inline)
    .map((a) => ({ type: 'message', messageId: source.id, idx: a.idx, filename: a.filename, size: a.size, contentType: a.contentType }))
}

/** Chips → payload refs. Extra keys (filename, size…) let an undone send reopen with the same chips. */
export function toPayloadAttachments(chips) {
  return (chips || [])
    .filter((a) => a.status === 'done')
    .map((a) => (a.type === 'upload'
      ? { type: 'upload', id: a.id, filename: a.filename, size: a.size, contentType: a.contentType }
      : { type: 'message', messageId: a.messageId, idx: a.idx, filename: a.filename, size: a.size, contentType: a.contentType }))
}

// ─── Initial state ──────────────────────────────────────────────────────────

/**
 * open() options → composer state.
 * With `source` (fullMessage) for reply/replyAll/forward/draft the fields are derived from it;
 * otherwise the given fields are used as-is (new message, or restoring an outbox payload).
 */
export function buildInitialState(opts = {}, { accounts = [], defaultAccountId } = {}) {
  const src = opts.source || null
  const mode = COMPOSE_MODES.includes(opts.mode) ? opts.mode : 'new'
  const find = (id) => (id ? accounts.find((a) => String(a.id) === String(id)) : null)
  const account = find(src?.accountId) || find(opts.accountId) || find(defaultAccountId) || accounts[0] || null
  const own = String(account?.email || '').toLowerCase()
  const typing = '<div><br></div>'
  const sig = signatureBlock(account)

  const base = {
    mode,
    accountId: account ? String(account.id) : String(opts.accountId || ''),
    to: [], cc: [], bcc: [],
    subject: '',
    html: typing + sig,
    quoteHtml: '',
    attachments: [],
    draftId: opts.draftId ? String(opts.draftId) : null,
    inReplyToId: opts.inReplyToId ? String(opts.inReplyToId) : null,
    dirty: !!opts.dirty,
  }

  if (src && (mode === 'reply' || mode === 'replyAll')) {
    const from = src.from?.address ? [src.from] : []
    const primary = src.replyTo?.length ? [src.replyTo[0]] : from
    const fromIsOwn = String(src.from?.address || '').toLowerCase() === own
    let to
    let cc = []
    if (fromIsOwn) {
      // Replying to something we sent → address the original recipients again.
      to = src.to || []
      if (mode === 'replyAll') cc = src.cc || []
    } else if (mode === 'replyAll') {
      to = [...primary, ...(src.to || [])]
      cc = src.cc || []
    } else {
      to = primary
    }
    to = dedupeAddresses(to, [own])
    if (!to.length) to = dedupeAddresses(primary)
    cc = dedupeAddresses(cc, [own, ...to.map((a) => a.address)])
    return {
      ...base,
      to, cc,
      subject: replySubject(src.subject),
      quoteHtml: buildReplyQuote(src),
      inReplyToId: String(src.id),
    }
  }

  if (src && mode === 'forward') {
    return {
      ...base,
      to: dedupeAddresses(opts.to),
      subject: forwardSubject(src.subject),
      html: typing + sig + buildForwardBlock(src),
      attachments: normalizeAttachments(messageAttachmentRefs(src)),
      inReplyToId: String(src.id),
    }
  }

  if (src && mode === 'draft') {
    return {
      ...base,
      to: dedupeAddresses(src.to),
      cc: dedupeAddresses(src.cc),
      bcc: dedupeAddresses(src.bcc),
      subject: src.subject || '',
      html: src.html ? prepareEditorHtml(src.html) : (src.text ? textToHtml(src.text) : typing),
      attachments: normalizeAttachments(messageAttachmentRefs(src)),
      draftId: String(src.id),
    }
  }

  let html = base.html
  if (typeof opts.html === 'string') {
    html = prepareEditorHtml(opts.html) || typing
    // Caller-provided body (e.g. a template) still gets the signature; restores already contain it.
    if (!opts.restore && opts.signature !== false && sig && !/data-signature/i.test(html)) html += sig
  }
  return {
    ...base,
    to: dedupeAddresses(opts.to),
    cc: dedupeAddresses(opts.cc),
    bcc: dedupeAddresses(opts.bcc),
    subject: opts.subject || '',
    html,
    quoteHtml: typeof opts.quoteHtml === 'string' ? opts.quoteHtml : '',
    attachments: normalizeAttachments(opts.attachments),
  }
}

// ─── Network ────────────────────────────────────────────────────────────────

/** JSON request against the mail API → `data`; throws Error(`error`) on failure. */
export async function mailApi(url, { method = 'GET', body, signal } = {}) {
  const res = await fetch(url, {
    method,
    signal,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json?.data
}

/** XHR upload so we get progress events → { promise, abort }. */
export function uploadMailFile(file, { onProgress } = {}) {
  const xhr = new XMLHttpRequest()
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', '/api/mail/uploads')
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => {
      let json = null
      try { json = JSON.parse(xhr.responseText) } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && json?.data?.id) resolve(json.data)
      else reject(new Error(json?.error || 'Upload failed'))
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { aborted: true }))
    const form = new FormData()
    form.append('file', file, file.name || 'attachment')
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

// ─── Scheduling ─────────────────────────────────────────────────────────────

const at = (d, h, m = 0) => setMilliseconds(setSeconds(setMinutes(setHours(d, h), m), 0), 0)

export function schedulePresets(now = new Date()) {
  const tomorrow = addDays(now, 1)
  return [
    { id: 'tomorrow-am', label: 'Tomorrow morning', date: at(tomorrow, 9) },
    { id: 'tomorrow-pm', label: 'Tomorrow afternoon', date: at(tomorrow, 13) },
    { id: 'monday-am', label: 'Monday morning', date: at(nextMonday(now), 9) },
  ]
}

export function validateSendAt(date, now = new Date()) {
  if (!date || !isValid(date)) return 'Pick a date and time'
  if (date.getTime() <= now.getTime() + 60 * 1000) return 'Pick a time in the future'
  if (date > addYears(now, 1)) return 'Pick a date within a year'
  return ''
}

export function formatScheduled(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (!isValid(d)) return ''
  const days = differenceInCalendarDays(d, now)
  if (days >= 0 && days < 7) return format(d, 'EEE h:mm a')
  return format(d, 'EEE, MMM d, h:mm a')
}

// ─── Crash-recovery mirror (localStorage) ──────────────────────────────────

export function writeMirror(key, data) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ ...data, aliveAt: Date.now() })) } catch { /* storage unavailable/full */ }
}

export function touchMirror(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return
    const data = JSON.parse(raw)
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ ...data, aliveAt: Date.now() }))
  } catch { /* ignore */ }
}

export function removeMirror(key) {
  try { localStorage.removeItem(STORAGE_PREFIX + key) } catch { /* ignore */ }
}

/** Unsaved composers left behind by a crash/reload (not ones still alive in another tab). */
export function readRecoverableMirrors() {
  const out = []
  try {
    const now = Date.now()
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue
      let data = null
      try { data = JSON.parse(localStorage.getItem(k)) } catch { /* corrupt */ }
      const aliveAt = Number(data?.aliveAt) || 0
      if (!data || !data.dirty || now - aliveAt > RECOVERY_MAX_AGE) { localStorage.removeItem(k); continue }
      if (now - aliveAt < RECOVERY_STALE_MS) continue
      out.push({ key: k.slice(STORAGE_PREFIX.length), data })
    }
  } catch { /* storage unavailable */ }
  return out.sort((a, b) => (b.data.aliveAt || 0) - (a.data.aliveAt || 0))
}
