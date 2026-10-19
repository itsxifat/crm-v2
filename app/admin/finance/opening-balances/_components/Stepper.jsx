'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STEPS } from '../_lib/meta'

/** Minimal step indicator (numbered dots joined by a line); scrolls sideways on narrow screens. */
export default function Stepper({ step, done = {}, onStep }) {
  return (
    <nav aria-label="Opening balance steps" className="overflow-x-auto scrollbar-none">
      <ol className="flex min-w-max items-center">
        {STEPS.map((s, i) => {
          const active = s.key === step
          const complete = !!done[s.key]
          return (
            <li key={s.key} className="flex items-center">
              <button
                type="button"
                onClick={() => onStep(s.key)}
                aria-current={active ? 'step' : undefined}
                className="group flex items-center gap-2 rounded-md py-1 pr-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors',
                  active
                    ? 'bg-gray-900 text-white'
                    : complete
                      ? 'bg-gray-100 text-gray-900'
                      : 'border border-gray-200 bg-white text-gray-500 group-hover:border-gray-300',
                )}>
                  {complete && !active ? <Check className="size-3.5" /> : s.key}
                </span>
                <span className={cn(
                  'whitespace-nowrap font-medium transition-colors',
                  active ? 'text-gray-900' : 'text-muted-foreground group-hover:text-gray-900',
                )}>
                  <span className="hidden sm:inline">{s.label}</span>
                  <span className="sm:hidden">{s.short}</span>
                </span>
              </button>
              {i < STEPS.length - 1 && <span className="mx-2 h-px w-6 bg-gray-200 sm:mx-3 sm:w-10" aria-hidden />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
