import { cn } from '@/lib/utils'

// `color` only tints the icon (same convention as components/ui/StatsCard).
const iconTint = {
  blue:   'text-blue-600',
  green:  'text-emerald-600',
  purple: 'text-violet-600',
  yellow: 'text-amber-600',
  red:    'text-red-600',
  indigo: 'text-indigo-600',
}

const shell = 'rounded-xl border border-gray-200/80 bg-white p-5 shadow-xs'

export default function StatCard({ label, value, icon: Icon, color = 'blue', sub, loading = false }) {
  if (loading) {
    return (
      <div className={shell}>
        <div className="flex items-center justify-between gap-3">
          <div className="h-3.5 w-24 animate-pulse rounded-md bg-gray-100" />
          <div className="size-8 animate-pulse rounded-lg bg-gray-100" />
        </div>
        <div className="mt-3 h-7 w-20 animate-pulse rounded-md bg-gray-100" />
      </div>
    )
  }

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
            <Icon className={cn('size-4', iconTint[color] ?? iconTint.blue)} />
          </div>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
