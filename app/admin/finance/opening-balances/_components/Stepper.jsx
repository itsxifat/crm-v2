'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STEPS } from '../_lib/meta'

/** Horizontal step indicator; scrolls sideways on narrow screens. */
export default function Stepper({ step, done = {}, onStep }) {
  return (
    <nav aria-label="Opening balance steps" className="bg-white border border-gray-100 rounded-xl p-2 overflow-x-auto">
      <ol className="flex items-center gap-1 min-w-max">
        {STEPS.map((s, i) => {
          const active = s.key === step
          const complete = !!done[s.key]
          return (
            <li key={s.key} className="flex items-center">
              <button
                type="button"
                onClick={() => onStep(s.key)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                  active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                <span className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0',
                  active ? 'bg-white text-gray-900' : complete ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500',
                )}>
                  {complete && !active ? <Check className="w-3.5 h-3.5" /> : s.key}
                </span>
                <span className="font-medium whitespace-nowrap">
                  <span className="hidden sm:inline">{s.label}</span>
                  <span className="sm:hidden">{s.short}</span>
                </span>
              </button>
              {i < STEPS.length - 1 && <span className="w-4 h-px bg-gray-200 mx-0.5" aria-hidden />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
