'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

/** Small dark tooltip. Wraps the child in a span so non-ref components (Badge, Avatar) work as triggers. */
export default function Tip({ content, side = 'top', focusable = false, className, children }) {
  if (!content) return children
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={cn('inline-flex', className)} tabIndex={focusable ? 0 : undefined}>{children}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-[70] max-w-xs break-words rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium leading-relaxed text-white shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
