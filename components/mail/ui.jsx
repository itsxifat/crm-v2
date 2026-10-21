'use client'

import { forwardRef, useEffect, useRef } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { avatarColor, initialsOf } from './mailUtils'

// Shared bits for the mailbox — same menu look as the app sidebar.

export const menuContent = 'z-[70] min-w-[200px] rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100'
export const menuItem = 'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none transition-colors data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
export const menuItemDanger = 'text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700'
export const menuSeparator = '-mx-1 my-1 h-px bg-gray-100'
export const menuLabel = 'px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground'

export function Tip({ label, shortcut, side = 'bottom', align = 'center', disabled, children }) {
  if (!label || disabled) return children
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-[80] flex max-w-xs items-center gap-1.5 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {label}
          {shortcut && <kbd className="rounded bg-white/15 px-1 font-sans text-[10px] font-medium leading-4 text-white/80">{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export const IconButton = forwardRef(function IconButton(
  { label, shortcut, tipSide, size = 'sm', active, className, children, ...props },
  ref
) {
  return (
    <Tip label={label} shortcut={shortcut} side={tipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md text-gray-500 outline-none transition-colors',
          'hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-ring/50',
          'disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-gray-100 data-[state=open]:text-gray-900',
          '[&_svg]:size-4 [&_svg]:shrink-0',
          size === 'sm' ? 'size-8' : 'size-7',
          active && 'text-gray-900',
          className
        )}
        {...props}
      >
        {children}
      </button>
    </Tip>
  )
})

export function Kbd({ children, className }) {
  return (
    <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-200 bg-gray-50 px-1 font-sans text-[11px] font-medium text-gray-600 shadow-xs', className)}>
      {children}
    </kbd>
  )
}

/** Native checkbox (forms plugin + globals styling). `onToggle(shiftKey)` so lists can range-select. */
export function Checkbox({ checked, indeterminate, onToggle, label, className, ...props }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={!!checked}
      onChange={() => {}}
      onClick={(e) => { e.stopPropagation(); onToggle?.(e.shiftKey) }}
      className={cn('size-4 cursor-pointer rounded-[5px] border-gray-300 text-gray-900 shadow-xs transition-colors focus:ring-2 focus:ring-ring/40 focus:ring-offset-0', className)}
      {...props}
    />
  )
}

export function Switch({ checked, onChange, label, className }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        checked ? 'bg-gray-900' : 'bg-gray-200',
        className
      )}
    >
      <span className={cn('inline-block size-3 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-3.5' : 'translate-x-0.5')} />
    </button>
  )
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-100', className)} />
}

const AVATAR_SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-9 text-[13px]',
}

export function MailAvatar({ addr, size = 'sm', className }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-1 ring-inset ring-black/5',
        AVATAR_SIZES[size] ?? AVATAR_SIZES.sm,
        avatarColor(addr?.address || addr?.name || ''),
        className
      )}
    >
      {initialsOf(addr)}
    </span>
  )
}

export function AccountDot({ color, className }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10', className)} style={{ backgroundColor: color || '#18181b' }} />
}

export function CountBadge({ count, strong, className }) {
  if (!count) return null
  return (
    <span className={cn('ml-auto shrink-0 text-xs tabular-nums', strong ? 'font-semibold text-gray-900' : 'text-gray-500', className)}>
      {count > 9999 ? '9999+' : count}
    </span>
  )
}
