'use client'

import * as Radix from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Custom Select dropdown — consistent across the entire app.
 *
 * Props:
 *   value       string | null
 *   onChange    (val: string | null) => void
 *   options     { value: string, label: string, disabled?: boolean }[]
 *   placeholder string
 *   disabled    boolean
 *   className   string  — applied to the trigger
 *   size        'sm' | 'md'  (default 'md')
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  className,
  size = 'md',
}) {
  return (
    <Radix.Root
      value={value ?? ''}
      onValueChange={(v) => onChange?.(v || null)}
      disabled={disabled}
    >
      <Radix.Trigger
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-white px-3 text-left text-gray-900 shadow-xs',
          'transition-[color,box-shadow,border-color] outline-none cursor-pointer',
          'hover:border-gray-300 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
          'data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/30',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60',
          size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm',
          className,
        )}
      >
        <span className="flex-1 truncate text-left">
          <Radix.Value placeholder={<span className="text-gray-400">{placeholder}</span>} />
        </span>
        <Radix.Icon className="shrink-0">
          <ChevronDown className="size-4 text-gray-400" />
        </Radix.Icon>
      </Radix.Trigger>

      <Radix.Portal>
        <Radix.Content
          position="popper"
          sideOffset={6}
          avoidCollisions
          collisionPadding={8}
          className={cn(
            'z-[9999] overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg',
            'min-w-[var(--radix-select-trigger-width)]',
            'max-h-[min(320px,var(--radix-select-content-available-height))]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          )}
        >
          <Radix.ScrollUpButton className="flex h-6 items-center justify-center bg-white text-gray-400">
            <ChevronUp className="size-4" />
          </Radix.ScrollUpButton>

          <Radix.Viewport className="p-1">
            {options.map((opt) => (
              <Radix.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={cn(
                  'relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-2.5 pr-8 outline-none',
                  'text-sm text-gray-700 transition-colors duration-75',
                  'data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900',
                  'data-[state=checked]:font-medium data-[state=checked]:text-gray-900',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
                )}
              >
                <Radix.ItemText>{opt.label}</Radix.ItemText>
                <Radix.ItemIndicator className="absolute right-2.5 flex items-center">
                  <Check className="size-4 text-gray-900" />
                </Radix.ItemIndicator>
              </Radix.Item>
            ))}
          </Radix.Viewport>

          <Radix.ScrollDownButton className="flex h-6 items-center justify-center bg-white text-gray-400">
            <ChevronDown className="size-4" />
          </Radix.ScrollDownButton>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}
