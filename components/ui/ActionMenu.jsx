'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'

/**
 * Row action menu rendered in a portal so it is never clipped by an
 * `overflow-x-auto` table container (the reason the old kebab menu appeared to
 * "do nothing"). Positions itself under the trigger with `position: fixed`.
 *
 * items: [{ label, icon: Icon, onClick?, href?, danger?, disabled?, hint? }]
 */
export default function ActionMenu({ items = [], align = 'right' }) {
  const [open, setOpen]   = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const btnRef  = useRef(null)
  const menuRef = useRef(null)

  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = 200
    const left = align === 'right' ? r.right - width : r.left
    setCoords({ top: r.bottom + 6, left: Math.max(8, left) })
  }, [align])

  useEffect(() => {
    if (!open) return
    place()
    const close = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', () => setOpen(false), true)
    window.addEventListener('resize', () => setOpen(false))
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: 200 }}
          className="z-[60] bg-white border border-gray-100 rounded-xl shadow-lg py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {items.filter(Boolean).map((it, i) => {
            const cls = `w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors ${
              it.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-gray-700 hover:bg-gray-50'
            } ${it.disabled ? 'opacity-40 cursor-not-allowed' : ''}`
            const Icon = it.icon
            const inner = (
              <>
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[10px] text-gray-400">{it.hint}</span>}
              </>
            )
            if (it.href && !it.disabled) {
              return <Link key={i} href={it.href} className={cls} onClick={() => setOpen(false)}>{inner}</Link>
            }
            return (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => { if (it.disabled) return; setOpen(false); it.onClick?.() }}
                className={cls}
              >
                {inner}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}
