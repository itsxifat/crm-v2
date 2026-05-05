import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

const colorMap = {
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',   ring: 'ring-blue-100' },
  green:   { bg: 'bg-green-50',   icon: 'text-green-600',  ring: 'ring-green-100' },
  purple:  { bg: 'bg-purple-50',  icon: 'text-purple-600', ring: 'ring-purple-100' },
  orange:  { bg: 'bg-orange-50',  icon: 'text-orange-600', ring: 'ring-orange-100' },
  red:     { bg: 'bg-red-50',     icon: 'text-red-600',    ring: 'ring-red-100' },
  yellow:  { bg: 'bg-yellow-50',  icon: 'text-yellow-600', ring: 'ring-yellow-100' },
  pink:    { bg: 'bg-pink-50',    icon: 'text-pink-600',   ring: 'ring-pink-100' },
  teal:    { bg: 'bg-teal-50',    icon: 'text-teal-600',   ring: 'ring-teal-100' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600',ring: 'ring-emerald-100' },
  indigo:  { bg: 'bg-indigo-50',  icon: 'text-indigo-600', ring: 'ring-indigo-100' },
}

export default function StatsCard({
  title,
  value,
  icon: Icon,
  change,
  changeLabel,
  positive,
  color = 'blue',
  href,
  className,
}) {
  const colors  = colorMap[color] ?? colorMap.blue
  const Wrapper = href ? 'a' : 'div'

  return (
    <Wrapper
      href={href}
      className={cn(
        'bg-white rounded-xl border border-gray-100 shadow-sm p-6 flex items-start justify-between',
        href && 'hover:shadow-md transition-shadow duration-200 cursor-pointer',
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-500 truncate">{title}</p>
        <p className="mt-1 text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
        {(change !== undefined || changeLabel) && (
          <div className={cn('mt-2 flex items-center gap-1 text-xs font-medium', positive !== false ? 'text-green-600' : 'text-red-600')}>
            {positive !== false ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            {change !== undefined && <span>{change}</span>}
            {changeLabel && <span className="text-gray-500 font-normal">{changeLabel}</span>}
          </div>
        )}
      </div>
      {Icon && (
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center ring-4 shrink-0', colors.bg, colors.ring)}>
          <Icon className={cn('w-5 h-5', colors.icon)} />
        </div>
      )}
    </Wrapper>
  )
}
