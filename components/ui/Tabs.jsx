'use client'

import { cn } from '@/lib/utils'

/**
 * Segmented tabs (shadcn TabsList look). Controlled.
 *   <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', icon: Inbox, count: 4 }]} />
 * variant: 'pill' (default) | 'underline'
 */
export default function Tabs({ tabs = [], value, onChange, variant = 'pill', size = 'default', className }) {
  const items = tabs.filter(Boolean)

  if (variant === 'underline') {
    return (
      <div className={cn('-mb-px flex max-w-full items-center gap-5 overflow-x-auto border-b border-gray-200 scrollbar-none', className)}>
        {items.map((t) => {
          const active = t.value === value
          const Icon = t.icon
          return (
            <button
              key={t.value}
              type="button"
              disabled={t.disabled}
              onClick={() => onChange?.(t.value)}
              className={cn(
                'relative inline-flex items-center gap-1.5 whitespace-nowrap pb-2.5 pt-1 text-sm font-medium transition-colors outline-none',
                'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full',
                active ? 'text-gray-900 after:bg-gray-900' : 'text-muted-foreground hover:text-gray-900 after:bg-transparent',
                'disabled:pointer-events-none disabled:opacity-50'
              )}
            >
              {Icon && <Icon className="size-4" />}
              {t.label}
              {t.count != null && <TabCount active={active}>{t.count}</TabCount>}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn('max-w-full overflow-x-auto scrollbar-none', className)}>
      <div
        role="tablist"
        className={cn(
          'inline-flex items-center rounded-lg bg-gray-100 p-[3px] text-muted-foreground',
          size === 'sm' ? 'h-8' : 'h-9'
        )}
      >
        {items.map((t) => {
          const active = t.value === value
          const Icon = t.icon
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={t.disabled}
              onClick={() => onChange?.(t.value)}
              className={cn(
                'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium transition-all outline-none',
                size === 'sm' ? 'text-xs' : 'text-sm',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
                active ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-900'
              )}
            >
              {Icon && <Icon className="size-4" />}
              {t.label}
              {t.count != null && <TabCount active={active}>{t.count}</TabCount>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TabCount({ active, children }) {
  return (
    <span
      className={cn(
        'min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-medium leading-[18px] tabular-nums',
        active ? 'bg-gray-900 text-white' : 'bg-gray-200/80 text-gray-600'
      )}
    >
      {children}
    </span>
  )
}

export { Tabs }
