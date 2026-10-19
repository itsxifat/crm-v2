import { cn } from '@/lib/utils'

export default function ProgressBar({ value = 0, max = 100, color = 'blue', size = 'md', showLabel = true }) {
  const percentage = Math.min(Math.round((value / max) * 100), 100)

  const colors = {
    blue:   'bg-blue-500',
    green:  'bg-emerald-500',
    yellow: 'bg-amber-500',
    red:    'bg-red-500',
    purple: 'bg-violet-500',
    indigo: 'bg-indigo-500',
  }

  const sizes = {
    sm:  'h-1.5',
    md:  'h-2',
    lg:  'h-3',
  }

  return (
    <div className="w-full">
      {showLabel && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Progress</span>
          <span className="text-xs font-medium tabular-nums text-gray-900">{percentage}%</span>
        </div>
      )}
      <div className={cn('w-full overflow-hidden rounded-full bg-gray-100', sizes[size] || sizes.md)}>
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', colors[color] || colors.blue)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
