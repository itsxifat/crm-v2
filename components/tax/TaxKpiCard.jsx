'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tone } from './taxUi'

/**
 * Dashboard KPI tile: a headline number, one line of context, an optional
 * status badge and ONE next action.
 *
 * Props:
 *   icon, title, value (node), sub (node), color (tint of the icon),
 *   badge (node), action: { label, href?, onClick? }, emphasis ('danger'|'warning'|null), loading
 */
export default function TaxKpiCard({ icon: Icon, title, value, sub, color = 'gray', badge = null, action = null, emphasis = null, loading = false }) {
  const t = tone(color)
  const border = emphasis === 'danger' ? 'border-red-200' : emphasis === 'warning' ? 'border-amber-200' : 'border-gray-200/80'
  const actionCls = 'inline-flex items-center gap-1 text-[13px] font-medium text-gray-900 underline-offset-4 hover:underline'
  return (
    <div className={cn('flex min-w-0 flex-col rounded-xl border bg-gradient-to-b from-white to-gray-50/60 p-5 shadow-xs', border)}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[13px] font-medium text-muted-foreground">{title}</p>
        {Icon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
            <Icon className={cn('size-4', t.icon)} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-28 animate-pulse rounded-md bg-gray-100" />
      ) : (
        <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      )}
      <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {loading ? <div className="h-3 w-40 animate-pulse rounded-md bg-gray-100" /> : (
          <>
            {badge}
            {sub && <span className="min-w-0">{sub}</span>}
          </>
        )}
      </div>
      {action && !loading && (
        <div className="mt-auto pt-4">
          <div className="border-t border-gray-100 pt-3">
            {action.href ? (
              <Link href={action.href} className={actionCls}>
                {action.label} <ArrowRight className="size-3.5" />
              </Link>
            ) : (
              <button type="button" onClick={action.onClick} className={actionCls}>
                {action.label} <ArrowRight className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
