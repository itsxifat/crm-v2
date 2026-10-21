'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { QUOTE_STYLE, escapeHtml, plainTextToHtml, sanitizePastedHtml } from './composeUtils'

const COMMANDS = {
  undo: 'undo',
  redo: 'redo',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikeThrough',
  ul: 'insertUnorderedList',
  ol: 'insertOrderedList',
  clear: 'removeFormat',
}

function queryState(cmd) {
  try { return document.queryCommandState(cmd) } catch { return false }
}

function caretRangeAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y)
  const pos = document.caretPositionFromPoint?.(x, y)
  if (!pos) return null
  const r = document.createRange()
  r.setStart(pos.offsetNode, pos.offset)
  r.collapse(true)
  return r
}

/**
 * Lightweight contentEditable editor (execCommand based, no deps). Uncontrolled:
 * the initial HTML is set once and read back through the ref, so React never
 * fights the caret.
 */
const RichTextEditor = forwardRef(function RichTextEditor(
  { initialHtml, onChange, onFiles, onRequestLink, onFormats, className },
  ref
) {
  const rootRef = useRef(null)
  const savedRange = useRef(null)
  const plainPaste = useRef(false)
  const internalDrag = useRef(false)
  const cb = useRef({})
  cb.current = { onChange, onFiles, onRequestLink, onFormats }
  // Constant object → React never re-applies innerHTML after mount.
  const [initial] = useState(() => ({ __html: initialHtml || '<div><br></div>' }))

  const changed = useCallback(() => cb.current.onChange?.(), [])

  const selectionInside = useCallback(() => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    const root = rootRef.current
    if (!sel || !sel.rangeCount || !root) return null
    return root.contains(sel.anchorNode) ? sel : null
  }, [])

  const closest = useCallback((selector) => {
    const sel = selectionInside()
    if (!sel) return null
    let n = sel.anchorNode
    if (n?.nodeType === 3) n = n.parentNode
    const el = n?.closest?.(selector)
    return el && el !== rootRef.current && rootRef.current.contains(el) ? el : null
  }, [selectionInside])

  const reportFormats = useCallback(() => {
    if (!selectionInside()) return
    cb.current.onFormats?.({
      bold: queryState('bold'),
      italic: queryState('italic'),
      underline: queryState('underline'),
      strike: queryState('strikeThrough'),
      ul: queryState('insertUnorderedList'),
      ol: queryState('insertOrderedList'),
      quote: !!closest('blockquote'),
      link: !!closest('a'),
    })
  }, [closest, selectionInside])

  useEffect(() => {
    const onSel = () => {
      const sel = selectionInside()
      if (!sel) return
      savedRange.current = sel.getRangeAt(0).cloneRange()
      reportFormats()
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [reportFormats, selectionInside])

  const restoreSelection = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    root.focus({ preventScroll: true })
    const r = savedRange.current
    if (r && root.contains(r.startContainer)) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }, [])

  const exec = useCallback((cmd, value) => {
    if (!selectionInside()) restoreSelection()
    try { document.execCommand(cmd, false, value) } catch { /* unsupported command */ }
    changed()
    reportFormats()
  }, [changed, reportFormats, restoreSelection, selectionInside])

  const insertHtml = useCallback((html) => {
    if (!html) return
    exec('insertHTML', html)
  }, [exec])

  const toggleQuote = useCallback(() => {
    const bq = closest('blockquote')
    if (!bq) { exec('formatBlock', '<blockquote>'); return }
    const parent = bq.parentNode
    while (bq.firstChild) parent.insertBefore(bq.firstChild, bq)
    bq.remove()
    changed()
    reportFormats()
  }, [changed, closest, exec, reportFormats])

  const placeCaret = useCallback((atEnd) => {
    const root = rootRef.current
    if (!root) return
    root.focus({ preventScroll: true })
    const range = document.createRange()
    if (atEnd) {
      range.selectNodeContents(root)
      range.collapse(false)
    } else {
      const first = root.firstChild
      if (first) range.setStart(first.nodeType === 1 ? first : root, 0)
      else range.setStart(root, 0)
      range.collapse(true)
    }
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }, [])

  useImperativeHandle(ref, () => ({
    getHtml() {
      const root = rootRef.current
      if (!root) return ''
      const clone = root.cloneNode(true)
      // Quotes made with the toolbar get the same inline style mail clients expect.
      clone.querySelectorAll('blockquote:not([style])').forEach((b) => b.setAttribute('style', QUOTE_STYLE))
      return clone.innerHTML
    },
    focus({ atEnd = false } = {}) { placeCaret(atEnd) },
    command(id) {
      if (id === 'quote') { toggleQuote(); return }
      const cmd = COMMANDS[id]
      if (cmd) exec(cmd)
    },
    beginLink() {
      const sel = selectionInside()
      if (sel) savedRange.current = sel.getRangeAt(0).cloneRange()
      const a = closest('a')
      return {
        href: a?.getAttribute('href') || '',
        text: a ? a.textContent : (savedRange.current?.toString() || ''),
        inLink: !!a,
      }
    },
    applyLink({ href, text }) {
      restoreSelection()
      const a = closest('a')
      if (a) {
        a.setAttribute('href', href)
        if (text && text !== a.textContent) a.textContent = text
        changed()
        return
      }
      const sel = window.getSelection()
      const selected = sel?.toString() || ''
      if (selected && (!text || text === selected)) exec('createLink', href)
      else exec('insertHTML', `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`)
    },
    removeLink() {
      restoreSelection()
      const a = closest('a')
      if (!a) return
      const range = document.createRange()
      range.selectNodeContents(a)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      exec('unlink')
    },
    cancelLink() { restoreSelection() },
    /** Replace the signature block's content; optionally insert one (above any quote) when missing. */
    swapSignature(html, { insertIfMissing = true } = {}) {
      const root = rootRef.current
      if (!root) return
      const blocks = root.querySelectorAll('[data-signature]')
      if (blocks.length) {
        blocks[0].innerHTML = html || ''
        // Enter inside the block can clone the attribute onto new lines.
        for (let i = 1; i < blocks.length; i++) blocks[i].removeAttribute('data-signature')
        return
      }
      if (!insertIfMissing || !html) return
      const frag = document.createRange().createContextualFragment(`<div><br></div><div data-signature>${html}</div>`)
      const quote = root.querySelector('[data-quote]')
      const anchor = quote && quote.parentNode === root ? (quote.previousElementSibling && !quote.previousElementSibling.textContent.trim() ? quote.previousElementSibling : quote) : null
      if (anchor) root.insertBefore(frag, anchor)
      else root.appendChild(frag)
    },
    appendHtml(html) {
      rootRef.current?.insertAdjacentHTML('beforeend', html)
    },
  }), [changed, closest, exec, placeCaret, restoreSelection, selectionInside, toggleQuote])

  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    if (e.shiftKey) {
      if (k === 'v') { plainPaste.current = true; setTimeout(() => { plainPaste.current = false }, 500); return }
      if (e.code === 'Digit7') { e.preventDefault(); exec('insertOrderedList') }
      else if (e.code === 'Digit8') { e.preventDefault(); exec('insertUnorderedList') }
      else if (e.code === 'Digit9') { e.preventDefault(); toggleQuote() }
      else if (k === 'x') { e.preventDefault(); exec('strikeThrough') }
      return
    }
    if (k === 'b') { e.preventDefault(); exec('bold') }
    else if (k === 'i') { e.preventDefault(); exec('italic') }
    else if (k === 'u') { e.preventDefault(); exec('underline') }
    else if (k === 'k') {
      e.preventDefault()
      const sel = selectionInside()
      if (sel) savedRange.current = sel.getRangeAt(0).cloneRange()
      cb.current.onRequestLink?.()
    } else if (k === '\\') { e.preventDefault(); exec('removeFormat') }
  }

  function onPaste(e) {
    const dt = e.clipboardData
    if (!dt) return
    const files = Array.from(dt.files || [])
    if (files.length) {
      e.preventDefault()
      cb.current.onFiles?.(files)
      return
    }
    const plain = plainPaste.current
    plainPaste.current = false
    const html = dt.getData('text/html')
    const text = dt.getData('text/plain')
    if (!html && !text) return
    e.preventDefault()
    if (!plain && html) insertHtml(sanitizePastedHtml(html))
    else insertHtml(plainTextToHtml(text))
  }

  function onDrop(e) {
    const dt = e.dataTransfer
    // Files bubble up to the composer window (attachments); in-editor moves stay native.
    if (!dt || dt.files?.length || internalDrag.current) return
    const html = dt.getData('text/html')
    const text = dt.getData('text/plain')
    if (!html && !text) return
    e.preventDefault()
    const range = caretRangeAt(e.clientX, e.clientY)
    if (range && rootRef.current?.contains(range.startContainer)) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
    insertHtml(html ? sanitizePastedHtml(html) : plainTextToHtml(text))
  }

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-label="Message"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      dangerouslySetInnerHTML={initial}
      onInput={changed}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragStart={() => { internalDrag.current = true }}
      onDragEnd={() => { internalDrag.current = false }}
      onFocus={() => {
        try {
          document.execCommand('defaultParagraphSeparator', false, 'div')
          document.execCommand('styleWithCSS', false, false)
        } catch { /* not supported */ }
      }}
      className={cn(
        'min-h-[160px] break-words px-4 py-3 text-sm leading-relaxed text-gray-900 outline-none',
        '[&_a]:text-blue-600 [&_a]:underline [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6',
        '[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600',
        '[&_img]:h-auto [&_img]:max-w-full [&_pre]:whitespace-pre-wrap [&_table]:max-w-full',
        className
      )}
    />
  )
})

export default RichTextEditor
