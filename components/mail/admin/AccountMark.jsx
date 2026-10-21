import { cn } from '@/lib/utils'
import { tint } from './api'

/** Soft colour tile with the account's initial — the account's colour identity across mail screens. */
export default function AccountMark({ color, name, size = 'md', className }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg font-semibold',
        size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm',
        className
      )}
      style={{ backgroundColor: tint(color, 0.1), color: color || '#18181b', boxShadow: `inset 0 0 0 1px ${tint(color, 0.18)}` }}
    >
      {initial}
    </span>
  )
}
