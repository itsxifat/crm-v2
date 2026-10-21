'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/** shadcn-style toggle. Pair with a <label htmlFor={id}> — clicking the label toggles it. */
const Switch = forwardRef(function Switch(
  { checked = false, onChange, disabled = false, size = 'default', className, ...props },
  ref
) {
  const sm = size === 'sm'
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full shadow-xs outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        sm ? 'h-[18px] w-8' : 'h-5 w-9',
        checked ? 'bg-gray-900' : 'bg-gray-200',
        className
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-sm transition-transform duration-150',
          sm ? 'size-3.5' : 'size-4',
          checked ? (sm ? 'translate-x-4' : 'translate-x-[18px]') : 'translate-x-0.5'
        )}
      />
    </button>
  )
})

export default Switch
export { Switch }
