'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'

const BASE_STYLE = 'html,body{margin:0;padding:0}body{font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;border-left:2px solid #e4e4e7;padding-left:1ex;color:#52525b}'
// Clearfix so the body box includes its first/last child margins and floats — makes height measurable.
const MEASURE_STYLE = 'body:before,body:after{content:"";display:table}body:after{clear:both}'

export function buildSrcDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${BASE_STYLE}${MEASURE_STYLE}</style></head><body>${html || ''}</body></html>`
}

/**
 * Sanitised email HTML in a sandboxed iframe (no scripts). Height follows the
 * content; wide newsletters widen the iframe and scroll horizontally inside the
 * wrapper instead of stretching the reader.
 */
export default function EmailFrame({ html, onMailto, title = 'Message body', className }) {
  const wrapRef = useRef(null)
  const frameRef = useRef(null)
  const wideRef = useRef(false)
  const cleanupRef = useRef(null)
  const onMailtoRef = useRef(onMailto)
  onMailtoRef.current = onMailto

  const srcDoc = useMemo(() => buildSrcDoc(html), [html])

  const measure = useCallback(() => {
    const frame = frameRef.current
    const doc = frame?.contentDocument
    const body = doc?.body
    if (!frame || !body) return
    const cs = doc.defaultView?.getComputedStyle(body)
    const margins = cs ? (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0) : 0
    const h = Math.ceil(Math.max(body.getBoundingClientRect().height + margins, body.scrollHeight))
    const current = parseFloat(frame.style.height) || 0
    if (Math.abs(current - h) > 1) frame.style.height = `${h}px`

    if (!wideRef.current) {
      const sw = doc.documentElement.scrollWidth
      if (sw > frame.clientWidth + 1) {
        wideRef.current = true
        frame.style.width = `${sw}px`
      }
    }
  }, [])

  // The reader got narrower/wider: drop the forced width and re-measure at 100%.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    let lastWidth = wrap.clientWidth
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth
      if (Math.abs(w - lastWidth) < 1) return
      lastWidth = w
      if (wideRef.current && frameRef.current) {
        wideRef.current = false
        frameRef.current.style.width = '100%'
      }
      measure()
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [measure])

  const onLoad = useCallback(() => {
    cleanupRef.current?.()
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (!frame || !doc?.body) return
    wideRef.current = false
    frame.style.width = '100%'
    measure()

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
    ro?.observe(doc.body)
    const onAssetLoad = () => measure()
    doc.addEventListener('load', onAssetLoad, true)
    const onClick = (e) => {
      const a = e.target?.closest?.('a[href]')
      const href = a?.getAttribute('href') || ''
      if (/^mailto:/i.test(href) && onMailtoRef.current) {
        e.preventDefault()
        onMailtoRef.current(href)
      }
    }
    doc.addEventListener('click', onClick)
    // Keyboard shortcuts keep working after clicking into the message body.
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true }))
    }
    doc.addEventListener('keydown', onKey)
    // Late layout shifts (web fonts, lazy images) that don't resize the body box.
    const timers = [150, 600, 1500].map(t => setTimeout(measure, t))

    cleanupRef.current = () => {
      ro?.disconnect()
      doc.removeEventListener('load', onAssetLoad, true)
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('keydown', onKey)
      timers.forEach(clearTimeout)
    }
  }, [measure])

  useEffect(() => () => cleanupRef.current?.(), [])

  return (
    <div ref={wrapRef} className={cn('w-full overflow-x-auto overflow-y-hidden', className)}>
      <iframe
        ref={frameRef}
        title={title}
        srcDoc={srcDoc}
        onLoad={onLoad}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        className="block h-6 w-full min-w-full border-0 bg-white"
      />
    </div>
  )
}

/** Print one message in a clean window (sandboxed iframes can't open the print dialog). */
export function printMessage({ subject, from, to, date, html }) {
  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) return false
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  w.document.open()
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(subject || 'Message')}</title><style>${BASE_STYLE}body{padding:32px;max-width:760px;margin:0 auto}.h{border-bottom:1px solid #e4e4e7;padding-bottom:12px;margin-bottom:20px}.h h1{font-size:18px;margin:0 0 8px}.h p{margin:2px 0;color:#52525b;font-size:13px}</style></head><body><div class="h"><h1>${esc(subject || '(no subject)')}</h1><p><b>From:</b> ${esc(from)}</p>${to ? `<p><b>To:</b> ${esc(to)}</p>` : ''}<p><b>Date:</b> ${esc(date)}</p></div>${html || ''}</body></html>`)
  w.document.close()
  w.focus()
  // Give remote images a moment before the dialog snapshots the page.
  setTimeout(() => { try { w.print() } catch {} }, 350)
  return true
}
