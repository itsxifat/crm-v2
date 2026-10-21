'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Clock, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** toast.custom body: label, optional countdown, Undo, and a draining progress bar. */
export default function UndoToast({ t, label, seconds, countdown = true, onUndo }) {
  const [left, setLeft] = useState(seconds)
  const [drain, setDrain] = useState(false)

  useEffect(() => {
    const started = Date.now()
    const id = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000))
      setLeft(remaining)
      if (remaining <= 0) clearInterval(id)
    }, 250)
    const raf = requestAnimationFrame(() => setDrain(true))
    return () => { clearInterval(id); cancelAnimationFrame(raf) }
  }, [seconds])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto relative flex w-[340px] max-w-[calc(100vw-2rem)] items-center gap-3 overflow-hidden rounded-xl border border-gray-200 bg-white py-2 pl-3.5 pr-1.5 text-sm font-medium text-gray-900 shadow-lg',
        'animate-in fade-in-0 slide-in-from-top-2 transition-opacity duration-200',
        t.visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {countdown
        ? <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />
        : <Clock className="size-4 shrink-0 text-gray-400" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {countdown && <span className="text-xs tabular-nums text-gray-400">{left}s</span>}
      <button
        type="button"
        onClick={onUndo}
        className="rounded-md px-2 py-1 text-[13px] font-semibold text-gray-900 hover:bg-gray-100"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={() => toast.dismiss(t.id)}
        aria-label="Dismiss"
        className="inline-flex size-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900"
      >
        <X className="size-3.5" />
      </button>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gray-100">
        <div
          className="h-full bg-gray-900"
          style={{ width: drain ? '0%' : '100%', transition: `width ${seconds}s linear` }}
        />
      </div>
    </div>
  )
}
