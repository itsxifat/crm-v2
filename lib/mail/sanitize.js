// Server-side HTML hygiene for email bodies. Email HTML is untrusted markup from
// anyone on the internet: it is sanitised here and rendered in a sandboxed iframe.
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'a', 'abbr', 'acronym', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br',
  'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i',
  'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'section', 'small', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
]

const CELL_ATTRS = ['colspan', 'rowspan', 'nowrap', 'headers', 'scope', 'abbr']

const ALLOWED_ATTRIBUTES = {
  '*': ['style', 'class', 'id', 'title', 'dir', 'lang', 'align', 'valign', 'width', 'height', 'bgcolor', 'background', 'border', 'role', 'aria-label', 'aria-hidden'],
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'srcset', 'alt', 'data-src', 'data-srcset', 'hspace', 'vspace'],
  font: ['color', 'face', 'size'],
  table: ['cellpadding', 'cellspacing', 'summary', 'frame', 'rules'],
  td: CELL_ATTRS,
  th: CELL_ATTRS,
  col: ['span'],
  colgroup: ['span'],
  ol: ['start', 'type', 'reversed'],
  ul: ['type'],
  li: ['value', 'type'],
  blockquote: ['cite'],
  q: ['cite'],
  del: ['cite', 'datetime'],
  ins: ['cite', 'datetime'],
  time: ['datetime'],
  hr: ['size', 'noshade', 'color'],
  details: ['open'],
}

// Disallowed tags whose *text* must be dropped too (otherwise e.g. <title> or SVG text leaks into the body).
const NON_TEXT_TAGS = ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'svg', 'math', 'template', 'xml', 'object', 'applet', 'select']

const REMOTE_RE = /^(?:https?:)?\/\//i
const CSS_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi

function normCid(v) {
  let s = String(v || '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '')
  try { s = decodeURIComponent(s) } catch { /* keep raw */ }
  return s.trim().toLowerCase()
}

function cidHref(value, ctx) {
  const idx = ctx.cids.get(normCid(value))
  if (idx == null || !ctx.messageId) return null
  return `/api/mail/messages/${ctx.messageId}/attachments/${idx}?inline=1`
}

// URL-valued attribute (background=…): returns the value to keep, or null to drop it.
function rewriteUrlAttr(value, ctx) {
  const url = String(value || '').trim()
  if (!url) return null
  if (/^cid:/i.test(url)) return cidHref(url, ctx)
  if (REMOTE_RE.test(url)) {
    if (ctx.allowRemote) return url
    ctx.blocked = true
    return null
  }
  if (/^data:image\//i.test(url)) return url
  return null
}

// CSS from <style> blocks and style="" attributes.
function rewriteCss(css, ctx) {
  return String(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'x-expr(')
    .replace(/(?:-moz-binding|behavior)\s*:[^;}]*/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(CSS_URL_RE, (match, _q, raw) => {
      const url = String(raw || '').trim()
      if (/^cid:/i.test(url)) {
        const href = cidHref(url, ctx)
        return href ? `url('${href}')` : 'none'
      }
      if (REMOTE_RE.test(url)) {
        if (ctx.allowRemote) return match
        ctx.blocked = true
        return 'none'
      }
      if (/^data:image\//i.test(url)) return match
      return 'none'
    })
}

/**
 * Sanitise email HTML for display → { html, remoteBlocked }.
 * cid: images are rewritten to the attachment endpoint; remote images/backgrounds are
 * stripped (kept in data-src) unless allowRemote, and remoteBlocked reports whether any were.
 */
export function sanitizeEmailHtml(html, { allowRemote = false, messageId, attachments = [] } = {}) {
  if (!html) return { html: '', remoteBlocked: false }

  const ctx = { allowRemote: !!allowRemote, messageId: messageId ? String(messageId) : null, blocked: false, cids: new Map() }
  for (const a of attachments || []) {
    if (a?.cid != null && a.idx != null) ctx.cids.set(normCid(a.cid), a.idx)
  }

  // sanitize-html passes <style> text through verbatim, so clean the CSS before it does.
  const input = String(html).replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_m, open, css, close) => `${open}${rewriteCss(css, ctx)}${close}`)

  const out = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'background'],
    allowProtocolRelative: true,
    allowVulnerableTags: true, // <style> is needed for real-world email layouts; its CSS is cleaned above
    nonTextTags: NON_TEXT_TAGS,
    disallowedTagsMode: 'discard',
    transformTags: {
      // Keep the body's background/colour attributes by turning it into a wrapper div.
      body: (_tag, attribs) => ({ tagName: 'div', attribs }),
      '*': (tagName, attribs) => {
        const a = { ...attribs }
        if (a.style) a.style = rewriteCss(a.style, ctx)
        if (a.background != null) {
          const v = rewriteUrlAttr(a.background, ctx)
          if (v) a.background = v
          else delete a.background
        }
        if (tagName === 'img') {
          const src = String(a.src || '').trim()
          if (/^cid:/i.test(src)) {
            const href = cidHref(src, ctx)
            if (href) a.src = href
            else delete a.src
          } else if (REMOTE_RE.test(src)) {
            if (!ctx.allowRemote) {
              a['data-src'] = src
              delete a.src
              ctx.blocked = true
            }
          } else if (/^data:/i.test(src) && !/^data:image\//i.test(src)) {
            delete a.src
          }
          if (a.srcset && !ctx.allowRemote && /(^|[\s,])(?:https?:)?\/\//i.test(a.srcset)) {
            a['data-srcset'] = a.srcset
            delete a.srcset
            ctx.blocked = true
          }
        }
        if (tagName === 'a' && a.href) {
          a.target = '_blank'
          a.rel = 'noopener noreferrer'
        }
        return { tagName, attribs: a }
      },
    },
  })

  return { html: out, remoteBlocked: ctx.blocked }
}

// ─── Plain-text helpers ──────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', bull: '•', middot: '·', euro: '€', pound: '£',
  yen: '¥', cent: '¢', laquo: '«', raquo: '»', times: '×', divide: '÷', deg: '°', plusmn: '±',
  para: '¶', sect: '§', iexcl: '¡', iquest: '¿', shy: '', zwnj: '', zwj: '', lrm: '', rlm: '',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', hearts: '♥', check: '✓', star: '☆', frac12: '½',
  frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ', acute: '´', uml: '¨', ordf: 'ª', ordm: 'º',
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m
      try { return String.fromCodePoint(code) } catch { return m }
    }
    const v = NAMED_ENTITIES[ent.toLowerCase()]
    return v != null ? v : m
  })
}

/**
 * Simple HTML → plain text (snippets, quoting, text/plain alternatives).
 * `links: true` appends " <url>" after link text that doesn't already show the URL.
 */
export function htmlToText(html, { links = true } = {}) {
  if (!html) return ''
  let s = String(html)
    .replace(/[\u0001\u0002]/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title|noscript|template|svg|xml|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // a truncated fragment may end inside a <style>/<head> block
    .replace(/<(style|script|head)\b[\s\S]*$/i, ' ')

  if (links) {
    s = s.replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q, href, inner) => {
      const text = inner.replace(/<[^>]+>/g, '').trim()
      const url = decodeEntities(href).trim()
      if (!/^https?:\/\//i.test(url)) return inner
      const shown = decodeEntities(text)
      if (!shown) return url
      // \u0001/\u0002 stand in for <> so the tag stripper below leaves the URL alone.
      return shown.includes(url) || url.replace(/^https?:\/\//i, '').startsWith(shown.replace(/^https?:\/\//i, '')) ? inner : `${inner} \u0001${url}\u0002`
    })
  }

  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/?(p|div|tr|h[1-6]|blockquote|table|thead|tbody|tfoot|section|article|header|footer|ul|ol|pre|dd|dt|dl|center|hr|address|figure|figcaption|main|nav|aside)\b[^>]*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')

  s = decodeEntities(s)
    .replace(/[\u200B-\u200D\u2060\uFEFF\u034F\u00AD]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\u0001/g, '<')
    .replace(/\u0002/g, '>')

  return s
    .split('\n')
    .map(line => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Applied to already-escaped text, so entity sequences end a URL.
const LINKIFY_RE = /((?:https?:\/\/|www\.)(?:(?!&quot;|&lt;|&gt;|&#39;)[^\s])+)|([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi

/** Plain text → HTML: escape, linkify URLs and email addresses, newlines → <br>. */
export function textToHtml(text) {
  if (text == null || text === '') return ''
  const linked = escapeHtml(text).replace(LINKIFY_RE, (m, url, email) => {
    if (email) return `<a href="mailto:${email}" target="_blank" rel="noopener noreferrer">${email}</a>`
    const trail = (url.match(/(?:[.,;:!?)\]}]|&amp;)+$/) || [''])[0]
    const core = trail ? url.slice(0, -trail.length) : url
    if (!core) return m
    const href = /^www\./i.test(core) ? `https://${core}` : core
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${core}</a>${trail}`
  })
  return linked.replace(/\r\n|\r|\n/g, '<br>\n')
}
