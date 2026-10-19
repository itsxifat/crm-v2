'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 300,
  className,
}) {
  const [localValue, setLocalValue] = useState(value ?? '')
  const timerRef = useRef(null)

  useEffect(() => {
    setLocalValue(value ?? '')
  }, [value])

  const handleChange = (e) => {
    const val = e.target.value
    setLocalValue(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onChange?.(val)
    }, debounceMs)
  }

  // Cancel any pending debounce on unmount.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleClear = () => {
    // Drop the pending debounce so it can't re-apply the old text after clearing.
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setLocalValue('')
    onChange?.('')
  }

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-input bg-white pl-9 pr-8 text-sm text-gray-900 shadow-xs outline-none transition-[color,box-shadow,border-color] placeholder:text-gray-400 focus:border-ring focus:ring-[3px] focus:ring-ring/30"
      />
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
