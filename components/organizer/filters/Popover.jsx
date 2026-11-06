'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const MOBILE_BP = 640
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Lightweight controlled popover rendered in a portal (never clipped by overflow
 * containers). Anchored under the trigger on desktop, bottom sheet on phones.
 *   <Popover open={open} onOpenChange={setOpen} trigger={<button onClick={() => setOpen(o => !o)}>…</button>}>…</Popover>
 * Not for use inside a Radix dialog (focus trap) — dialogs use inline dropdowns.
 */
export default function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  width = 260,
  title,
  className,
}) {
  const anchorRef = useRef(null)
  const panelRef = useRef(null)
  const backdropRef = useRef(null)
  const [pos, setPos] = useState(null)

  const close = useCallback(() => onOpenChange?.(false), [onOpenChange])

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (vw < MOBILE_BP) { setPos({ mobile: true }); return }
    const r = el.getBoundingClientRect()
    const w = Math.min(width, vw - 16)
    let left = align === 'end' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, vw - w - 8))
    const below = vh - r.bottom - 14
    const above = r.top - 14
    if (below < 260 && above > below) {
      setPos({ mobile: false, bottom: vh - r.top + 6, left, width: w, maxHeight: Math.min(above, 420) })
    } else {
      setPos({ mobile: false, top: r.bottom + 6, left, width: w, maxHeight: Math.min(Math.max(below, 160), 420) })
    }
  }, [align, width])

  useIsoLayoutEffect(() => {
    if (open) place()
    else setPos(null)
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      const t = e.target
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      // Phone sheet: the backdrop closes on its own click. Closing on touchstart would remove it
      // mid-tap and the tap's click would land on the page underneath.
      if (backdropRef.current?.contains(t)) return
      // A date picker popup (portalled) opened from inside this popover.
      if (t?.closest?.('[data-datepicker-popup]') || document.querySelector('[data-datepicker-popup]')) return
      close()
    }
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-datepicker-popup]')) close() }
    const onScroll = (e) => { if (!panelRef.current?.contains(e.target)) place() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close, place])

  const panel = open && pos && typeof document !== 'undefined' && createPortal(
    pos.mobile ? (
      <>
        <div ref={backdropRef} className="pointer-events-auto fixed inset-0 z-[60] bg-black/40 animate-in fade-in-0" onClick={close} />
        <div
          ref={panelRef}
          className={cn(
            'pointer-events-auto fixed inset-x-0 bottom-0 z-[61] flex max-h-[85vh] flex-col rounded-t-2xl bg-white pb-[max(env(safe-area-inset-bottom),12px)] shadow-2xl',
            'animate-in slide-in-from-bottom duration-200',
          )}
        >
          <div className="mx-auto mb-1 mt-2.5 h-1 w-10 shrink-0 rounded-full bg-gray-200" />
          {title && <p className="shrink-0 px-4 pb-1 pt-1.5 text-sm font-semibold text-gray-900">{title}</p>}
          <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>
        </div>
      </>
    ) : (
      <div
        ref={panelRef}
        style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        className={cn(
          'pointer-events-auto z-[60] flex flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg',
          'animate-in fade-in-0 zoom-in-95 duration-100',
        )}
      >
        <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>
      </div>
    ),
    document.body,
  )

  return (
    <>
      <span ref={anchorRef} className="inline-flex max-w-full">{trigger}</span>
      {panel}
    </>
  )
}
