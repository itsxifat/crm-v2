'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Bold, Italic, Link2, List, ListOrdered, Redo2, RemoveFormatting, Strikethrough, TextQuote, Underline, Undo2,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { IconButton, MOD } from './parts'
import { isValidAddress } from './composeUtils'

const GROUPS = [
  [
    { id: 'undo', icon: Undo2, label: 'Undo', kbd: `${MOD}Z` },
    { id: 'redo', icon: Redo2, label: 'Redo', kbd: `${MOD}Y` },
  ],
  [
    { id: 'bold', icon: Bold, label: 'Bold', kbd: `${MOD}B` },
    { id: 'italic', icon: Italic, label: 'Italic', kbd: `${MOD}I` },
    { id: 'underline', icon: Underline, label: 'Underline', kbd: `${MOD}U` },
    { id: 'strike', icon: Strikethrough, label: 'Strikethrough', kbd: `${MOD}Shift+X` },
  ],
  [
    { id: 'ul', icon: List, label: 'Bulleted list', kbd: `${MOD}Shift+8` },
    { id: 'ol', icon: ListOrdered, label: 'Numbered list', kbd: `${MOD}Shift+7` },
    { id: 'quote', icon: TextQuote, label: 'Quote', kbd: `${MOD}Shift+9` },
  ],
  [
    { id: 'link', icon: Link2, label: 'Insert link', kbd: `${MOD}K`, state: 'link' },
    { id: 'clear', icon: RemoveFormatting, label: 'Remove formatting', kbd: `${MOD}\\` },
  ],
]

export default function EditorToolbar({ formats = {}, onCommand, onLink, className }) {
  return (
    <div role="toolbar" aria-label="Formatting" className={cn('flex flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-0.5', className)}>
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden />}
          {group.map((b) => (
            <IconButton
              key={b.id}
              icon={b.icon}
              label={b.label}
              kbd={b.kbd}
              keepFocus
              pressed={b.id === 'undo' || b.id === 'redo' || b.id === 'clear' ? undefined : !!formats[b.state || b.id]}
              className="size-7"
              onClick={() => (b.id === 'link' ? onLink?.() : onCommand?.(b.id))}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function normalizeUrl(value) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v
  if (isValidAddress(v)) return `mailto:${v}`
  return `https://${v.replace(/^\/+/, '')}`
}

/** Small anchored form for inserting/editing a link (no window.prompt). */
export function LinkPopover({ initial, onApply, onRemove, onClose }) {
  const [text, setText] = useState(initial?.text || '')
  const [href, setHref] = useState(initial?.href || '')
  const boxRef = useRef(null)
  const urlRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    urlRef.current?.focus()
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) closeRef.current?.({ restore: false }) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function submit() {
    const url = normalizeUrl(href)
    if (!url) return
    onApply({ href: url, text: text.trim() })
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose({ restore: true }) }
  }

  return (
    <div
      ref={boxRef}
      onKeyDown={onKeyDown}
      className="absolute bottom-full left-3 z-20 mb-2 w-[300px] max-w-[calc(100%-1.5rem)] space-y-2 rounded-xl border border-gray-200/80 bg-white p-3 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text" className="h-8 text-[13px]" />
      <Input ref={urlRef} value={href} onChange={(e) => setHref(e.target.value)} placeholder="Link" className="h-8 text-[13px]" />
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        {initial?.inLink && <Button size="xs" variant="ghost" onClick={onRemove}>Remove</Button>}
        <Button size="xs" onClick={submit} disabled={!href.trim()}>Apply</Button>
      </div>
    </div>
  )
}
