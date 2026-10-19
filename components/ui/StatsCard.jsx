import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

// `color` only tints the icon, so alert states (red/orange/yellow) still read at a glance.
const iconTint = {
  blue:    'text-blue-600',
  green:   'text-emerald-600',
  emerald: 'text-emerald-600',
  purple:  'text-violet-600',
  indigo:  'text-indigo-600',
  orange:  'text-orange-600',
  red:     'text-red-600',
  yellow:  'text-amber-600',
  pink:    'text-pink-600',
  teal:    'text-teal-600',
  gray:    'text-gray-500',
}

export default function StatsCard({
  title,
  value,
  icon: Icon,
  change,
  changeLabel,
  positive,
  color = 'gray',
  href,
  className,
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[13px] font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
            <Icon className={cn('size-4', iconTint[color] ?? iconTint.gray)} />
          </div>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      {(change !== undefined || changeLabel) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs">
          {change !== undefined && (
            <span className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              positive !== false ? 'text-emerald-600' : 'text-red-600'
            )}>
              {positive !== false ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {change}
            </span>
          )}
          {changeLabel && <span className="text-muted-foreground">{changeLabel}</span>}
        </div>
      )}
    </>
  )

  const classes = cn(
    'block rounded-xl border border-gray-200/80 bg-gradient-to-b from-white to-gray-50/60 p-5 shadow-xs',
    href && 'transition-all duration-200 hover:border-gray-300 hover:shadow-md',
    className
  )

  return href
    ? <Link href={href} className={classes}>{body}</Link>
    : <div className={classes}>{body}</div>
}
