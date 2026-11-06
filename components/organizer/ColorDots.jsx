'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PALETTE, PALETTE_KEYS } from './constants'

/** Palette picker: a row of colour dots. `allowNone` adds a "default" option (value null). */
export default function ColorDots({ value, onChange, size = 'md', allowNone = false, className }) {
  const dim = size === 'sm' ? 'size-5' : 'size-6'
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="radiogroup">
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={value == null}
          title="Default"
          onClick={() => onChange?.(null)}
          className={cn(
            dim,
            'flex items-center justify-center rounded-full border border-dashed border-gray-300 bg-white text-gray-400 transition',
            value == null && 'ring-2 ring-gray-900 ring-offset-1'
          )}
        >
          {value == null && <Check className="size-3" />}
        </button>
      )}
      {PALETTE_KEYS.map((key) => {
        const c = PALETTE[key]
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            title={c.label}
            onClick={() => onChange?.(key)}
            className={cn(
              dim,
              'flex items-center justify-center rounded-full text-white transition hover:scale-110',
              c.dot,
              active && 'ring-2 ring-gray-900 ring-offset-1'
            )}
          >
            {active && <Check className="size-3" />}
          </button>
        )
      })}
    </div>
  )
}
