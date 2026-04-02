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
  const py       = size === 'sm' ? 'py-1.5' : 'py-2'
  const textSize = size === 'sm' ? 'text-xs'  : 'text-sm'

  return (
    <Radix.Root
      value={value ?? ''}
      onValueChange={(v) => onChange?.(v || null)}
      disabled={disabled}
    >
      <Radix.Trigger
        className={cn(
          'flex items-center justify-between w-full px-3 gap-2 border rounded-lg bg-white',
          'text-left transition-all duration-150 cursor-pointer',
          'border-gray-200 hover:border-gray-300',
          'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50',
          py, textSize,
          className,
        )}
      >
        <span className="flex-1 truncate text-left">
          <Radix.Value placeholder={<span className="text-gray-400">{placeholder}</span>} />
        </span>
        <Radix.Icon className="shrink-0">
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        </Radix.Icon>
      </Radix.Trigger>

      <Radix.Portal>
        <Radix.Content
          position="popper"
          sideOffset={5}
          avoidCollisions
          collisionPadding={8}
          className={cn(
            'z-[9999] overflow-hidden rounded-xl bg-white border border-gray-100',
            'shadow-[0_8px_30px_rgba(0,0,0,0.10)]',
            'min-w-[var(--radix-select-trigger-width)]',
            'max-h-[min(320px,var(--radix-select-content-available-height))]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          )}
        >
          <Radix.ScrollUpButton className="flex items-center justify-center h-6 bg-white text-gray-400 border-b border-gray-50">
            <ChevronUp className="w-3.5 h-3.5" />
          </Radix.ScrollUpButton>

          <Radix.Viewport className="p-1.5">
            {options.map((opt) => (
              <Radix.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={cn(
                  'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer select-none outline-none',
                  'text-sm text-gray-700 transition-colors duration-100',
                  'data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
                  'data-[state=checked]:bg-blue-50 data-[state=checked]:text-blue-700 data-[state=checked]:font-medium',
                  'data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed',
                )}
              >
                <Radix.ItemText>{opt.label}</Radix.ItemText>
                <Radix.ItemIndicator>
                  <Check className="w-3.5 h-3.5 text-blue-500 shrink-0 ml-2" />
                </Radix.ItemIndicator>
              </Radix.Item>
            ))}
          </Radix.Viewport>

          <Radix.ScrollDownButton className="flex items-center justify-center h-6 bg-white text-gray-400 border-t border-gray-50">
            <ChevronDown className="w-3.5 h-3.5" />
          </Radix.ScrollDownButton>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}
