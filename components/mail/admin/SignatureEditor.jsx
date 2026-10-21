'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Link2, Unlink, RemoveFormatting, Code2, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const BLOCKED_TAGS = 'script,style,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,option,meta,link,base,svg,math,noscript,template'
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'background', 'poster', 'xlink:href', 'srcset'])

/**
 * Light client-side scrub so pasted / stored signature HTML can't run script inside the
 * editor (the parsed document is inert). The API sanitises again before storing / sending.
 */
export function cleanSignatureHtml(html) {
  if (!html) return ''
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  doc.body.querySelectorAll(BLOCKED_TAGS).forEach(el => el.remove())
  doc.body.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const val = attr.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue }
      if (!URL_ATTRS.has(name)) continue
      const scripted = /^(javascript|vbscript):/.test(val)
      const badData = val.startsWith('data:') && !(name === 'src' && /^data:image\/(png|jpe?g|gif|webp)/.test(val))
      if (scripted || badData) el.removeAttribute(attr.name)
    }
  })
  return doc.body.innerHTML
}

const EMPTY_RE = /^(<br\s*\/?>|<div><br\s*\/?><\/div>|<p><br\s*\/?><\/p>)?$/i

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function normalizeUrl(raw) {
  const v = raw.trim()
  if (!v) return ''
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '' // other schemes (javascript: …) are refused
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return `mailto:${v}`
  if (/^\+?[\d\s().-]{6,}$/.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`
  return `https://${v}`
}

function ToolButton({ label, active, onClick, children }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      // Keep the editor's selection while clicking toolbar buttons.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md transition-colors',
        active ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
      )}
    >
      {children}
    </button>
  )
}

/** Minimal rich-text signature editor with an HTML source toggle. value/onChange are HTML strings. */
export default function SignatureEditor({ value = '', onChange, placeholder = 'Add a signature' }) {
  const editorRef = useRef(null)
  const lastHtml = useRef(null)
  const savedRange = useRef(null)
  const [mode, setMode] = useState('visual')
  const [link, setLink] = useState(null) // { url } while the link bar is open
  const [active, setActive] = useState({ bold: false, italic: false, underline: false })

  // Push external value changes into the editor, but never while it's the source of the change (keeps the caret).
  useEffect(() => {
    const el = editorRef.current
    if (!el || value === lastHtml.current) return
    el.innerHTML = cleanSignatureHtml(value)
    lastHtml.current = value
  }, [value])

  const emit = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    let html = el.innerHTML
    if (EMPTY_RE.test(html.trim())) {
      html = ''
      if (el.innerHTML) el.innerHTML = '' // restores the :empty placeholder
    }
    lastHtml.current = html
    onChange?.(html)
  }, [onChange])

  const refreshActive = useCallback(() => {
    const el = editorRef.current
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (!el || !sel?.anchorNode || !el.contains(sel.anchorNode)) return
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      })
    } catch {
      // queryCommandState can throw in some browsers when the selection is detached.
    }
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshActive)
    return () => document.removeEventListener('selectionchange', refreshActive)
  }, [refreshActive])

  const exec = (cmd, arg = null) => {
    editorRef.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
    refreshActive()
  }

  const selectionInEditor = () => {
    const sel = window.getSelection()
    return sel?.rangeCount && editorRef.current?.contains(sel.anchorNode) ? sel : null
  }

  const openLink = () => {
    const sel = selectionInEditor()
    savedRange.current = sel ? sel.getRangeAt(0).cloneRange() : null
    const anchor = sel?.anchorNode?.parentElement?.closest?.('a')
    setLink({ url: anchor && editorRef.current.contains(anchor) ? anchor.getAttribute('href') || '' : '' })
  }

  const applyLink = () => {
    const url = normalizeUrl(link?.url ?? '')
    setLink(null)
    if (!url) return
    const el = editorRef.current
    el.focus()
    const sel = window.getSelection()
    sel.removeAllRanges()
    if (savedRange.current) {
      sel.addRange(savedRange.current)
    } else {
      const r = document.createRange()
      r.selectNodeContents(el)
      r.collapse(false)
      sel.addRange(r)
    }
    if (sel.isCollapsed) {
      const text = url.replace(/^(mailto:|tel:|https?:\/\/)/i, '')
      document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`)
    } else {
      document.execCommand('createLink', false, url)
    }
    savedRange.current = null
    emit()
  }

  const onPaste = (e) => {
    const html = e.clipboardData?.getData('text/html')
    if (!html) return // plain text pastes natively
    e.preventDefault()
    document.execCommand('insertHTML', false, cleanSignatureHtml(html))
    emit()
  }

  const toggleMode = () => {
    setLink(null)
    setMode(m => (m === 'visual' ? 'source' : 'visual'))
  }

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-white shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
      <div className="flex items-center gap-0.5 border-b border-gray-100 px-1.5 py-1">
        {mode === 'visual' && (
          <>
            <ToolButton label="Bold" active={active.bold} onClick={() => exec('bold')}><Bold className="size-4" /></ToolButton>
            <ToolButton label="Italic" active={active.italic} onClick={() => exec('italic')}><Italic className="size-4" /></ToolButton>
            <ToolButton label="Underline" active={active.underline} onClick={() => exec('underline')}><Underline className="size-4" /></ToolButton>
            <span className="mx-1 h-4 w-px bg-gray-200" />
            <ToolButton label="Link" active={!!link} onClick={openLink}><Link2 className="size-4" /></ToolButton>
            <ToolButton label="Remove link" onClick={() => exec('unlink')}><Unlink className="size-4" /></ToolButton>
            <ToolButton label="Clear formatting" onClick={() => exec('removeFormat')}><RemoveFormatting className="size-4" /></ToolButton>
          </>
        )}
        <div className="ml-auto">
          <ToolButton label={mode === 'visual' ? 'Edit HTML' : 'Visual editor'} active={mode === 'source'} onClick={toggleMode}>
            <Code2 className="size-4" />
          </ToolButton>
        </div>
      </div>

      {link && mode === 'visual' && (
        <div className="flex items-center gap-2 border-b border-gray-100 py-1.5 pl-3 pr-1.5">
          <Link2 className="size-4 shrink-0 text-gray-400" />
          <input
            autoFocus
            value={link.url}
            onChange={e => setLink({ url: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } }}
            placeholder="https://"
            aria-label="Link URL"
            className="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
          />
          <Button size="xs" onClick={applyLink} disabled={!link.url.trim()}>Apply</Button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => setLink(null)}
            className="inline-flex size-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Stays mounted in source mode so its content survives the toggle. */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Signature"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onPaste={onPaste}
        onKeyUp={refreshActive}
        className={cn(
          'min-h-[148px] max-h-72 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed text-gray-900 outline-none',
          '[&_a]:text-blue-600 [&_a]:underline [&_img]:inline-block [&_img]:max-w-full',
          '[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5',
          'empty:before:pointer-events-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)]',
          mode !== 'visual' && 'hidden'
        )}
      />

      {mode === 'source' && (
        <textarea
          value={value}
          onChange={e => onChange?.(e.target.value)}
          spellCheck={false}
          aria-label="Signature HTML"
          placeholder="<p>…</p>"
          className="block min-h-[148px] w-full resize-y border-0 bg-transparent px-3 py-2.5 font-mono text-xs leading-relaxed text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
        />
      )}
    </div>
  )
}
