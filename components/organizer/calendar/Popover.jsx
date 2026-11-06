'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
const MOBILE_BP = 640

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/**
 * Lightweight anchored popover (portal, position: fixed). On phones it renders as a bottom sheet.
 *   anchorEl   element to anchor to (clicks on it don't count as "outside" — use for toggles)
 *   anchorRect DOMRect captured at click time (for transient anchors such as event chips)
 *   placement  'bottom' | 'bottom-end' | 'side'
 */
export default function Popover({
  open,
  onClose,
  anchorEl,
  anchorRect,
  placement = 'bottom',
  width = 320,
  label,
  className,
  children,
}) {
  const ref = useRef(null)
  const backdropRef = useRef(null)
  const [pos, setPos] = useState(null)
  const mobile = open && typeof window !== 'undefined' && window.innerWidth < MOBILE_BP

  const place = useCallback(() => {
    if (typeof window === 'undefined') return
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (vw < MOBILE_BP) { setPos({ mobile: true }); return }
    const rect = anchorEl?.getBoundingClientRect?.() ?? anchorRect
    const h = ref.current?.offsetHeight ?? 240
    const w = Math.min(width, vw - 16)
    let top
    let left
    if (!rect) {
      top = (vh - h) / 2
      left = (vw - w) / 2
    } else if (placement === 'side') {
      left = rect.right + 8
      if (left + w > vw - 8) left = rect.left - w - 8
      if (left < 8) {
        left = rect.left
        top = rect.bottom + 6
        if (top + h > vh - 8 && rect.top - h - 6 >= 8) top = rect.top - h - 6
      } else {
        top = rect.top - 4
      }
    } else {
      left = placement === 'bottom-end' ? rect.right - w : rect.left
      top = rect.bottom + 6
      if (top + h > vh - 8 && rect.top - h - 6 >= 8) top = rect.top - h - 6
    }
    setPos({ top: clamp(top, 8, vh - h - 8), left: clamp(left, 8, vw - w - 8), width: w })
  }, [anchorEl, anchorRect, placement, width])

  useIsoLayoutEffect(() => {
    if (!open) { setPos(null); return }
    place()
  }, [open, place])

  // Re-place when the content changes size (e.g. a confirm panel swaps in).
  useEffect(() => {
    if (!open || !ref.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => place())
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const isInside = (t) =>
      ref.current?.contains(t) ||
      anchorEl?.contains?.(t) ||
      t?.closest?.('[data-datepicker-popup],[data-radix-popper-content-wrapper]')
    const onDown = (e) => {
      // The sheet's backdrop closes on its own click: closing on touchstart would remove
      // it before the tap's click, which then lands on (and triggers) the grid beneath.
      if (backdropRef.current?.contains(e.target)) return
      if (!isInside(e.target)) onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const onScroll = (e) => {
      if (window.innerWidth < MOBILE_BP) return
      if (isInside(e.target)) return
      onClose?.()
    }
    // Phones resize when the on-screen keyboard or URL bar moves — keep the sheet open then.
    const onResize = () => {
      if (mobile && window.innerWidth < MOBILE_BP) return
      onClose?.()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, onClose, anchorEl, mobile])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    mobile ? (
      <>
        <div
          ref={backdropRef}
          onClick={(e) => { e.stopPropagation(); onClose?.() }}
          className="pointer-events-auto fixed inset-0 z-[60] bg-black/30 animate-in fade-in-0 duration-150"
        />
        <div
          ref={ref}
          role="dialog"
          aria-label={label}
          className={cn(
            'pointer-events-auto fixed inset-x-0 bottom-0 z-[61] max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white pb-6 shadow-2xl',
            'animate-in slide-in-from-bottom duration-200',
          )}
        >
          <div className="mx-auto mb-1 mt-2.5 h-1 w-10 rounded-full bg-gray-200" />
          {children}
        </div>
      </>
    ) : (
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        style={{
          position: 'fixed',
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          width: pos?.width ?? width,
          visibility: pos && !pos.mobile ? 'visible' : 'hidden',
        }}
        className={cn(
          'pointer-events-auto z-[60] max-h-[min(80vh,600px)] overflow-y-auto rounded-xl border border-gray-200/80 bg-white shadow-lg',
          'animate-in fade-in-0 zoom-in-95 duration-100',
          className,
        )}
      >
        {children}
      </div>
    ),
    document.body,
  )
}
