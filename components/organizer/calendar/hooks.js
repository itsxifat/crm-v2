'use client'

import { useEffect, useState } from 'react'

/** Current time, refreshed every `ms` (drives the now-line and "today"). */
export function useNow(ms = 60000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Content-box size of an element, kept in sync with a ResizeObserver. */
export function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (w, h) => setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }))
    measure(el.clientWidth, el.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      measure(Math.round(r.width), Math.round(r.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
