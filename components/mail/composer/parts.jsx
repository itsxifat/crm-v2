'use client'

import { forwardRef } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

// Same look as the sidebar's Radix menus.
export const menuContent = 'z-[70] min-w-[220px] rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100'
export const menuItem = 'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none transition-colors data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'

export function Tip({ label, kbd, side = 'top', children }) {
  if (!label) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-[70] flex items-center gap-1.5 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {label}
          {kbd && <span className="text-gray-400">{kbd}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Small muted icon button used across the composer chrome. */
export const IconButton = forwardRef(function IconButton(
  { icon: Icon, label, kbd, pressed, className, iconClassName, tipSide, keepFocus = false, onMouseDown, ...props },
  ref
) {
  return (
    <Tip label={label} kbd={kbd} side={tipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed === undefined ? undefined : !!pressed}
        onMouseDown={(e) => {
          // Toolbar buttons must not steal the editor's selection.
          if (keepFocus) e.preventDefault()
          onMouseDown?.(e)
        }}
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-gray-500 outline-none transition-colors',
          'hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-ring/50',
          'disabled:pointer-events-none disabled:opacity-40',
          pressed && 'bg-gray-100 text-gray-900',
          className
        )}
        {...props}
      >
        <Icon className={cn('size-4', iconClassName)} />
      </button>
    </Tip>
  )
})
