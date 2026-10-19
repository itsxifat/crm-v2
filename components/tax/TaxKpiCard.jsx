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
 *   icon, title, value (node), sub (node), color (tone of the icon chip),
 *   badge (node), action: { label, href?, onClick? }, emphasis ('danger'|'warning'|null), loading
 */
export default function TaxKpiCard({ icon: Icon, title, value, sub, color = 'gray', badge = null, action = null, emphasis = null, loading = false }) {
  const t = tone(color)
  const ring = emphasis === 'danger' ? 'border-red-200 ring-1 ring-red-100' : emphasis === 'warning' ? 'border-amber-200' : 'border-gray-100'
  return (
    <div className={cn('bg-white border rounded-xl p-4 sm:p-5 flex flex-col min-w-0', ring)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 truncate">{title}</p>
          {loading ? (
            <div className="mt-2 h-7 w-28 rounded bg-gray-100 animate-pulse" />
          ) : (
            <p className="mt-1 text-xl sm:text-2xl font-semibold tracking-tight text-gray-900 truncate">{value}</p>
          )}
        </div>
        {Icon && (
          <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', t.icon)}>
            <Icon style={{ width: 18, height: 18 }} />
          </span>
        )}
      </div>
      <div className="mt-2 min-h-[20px] flex flex-wrap items-center gap-2 text-xs text-gray-500">
        {loading ? <div className="h-3 w-40 rounded bg-gray-100 animate-pulse" /> : (
          <>
            {badge}
            {sub && <span className="min-w-0">{sub}</span>}
          </>
        )}
      </div>
      {action && !loading && (
        <div className="mt-3 pt-3 border-t border-gray-50">
          {action.href ? (
            <Link href={action.href} className="inline-flex items-center gap-1 text-sm font-medium text-gray-900 hover:text-gray-600">
              {action.label} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className="inline-flex items-center gap-1 text-sm font-medium text-gray-900 hover:text-gray-600">
              {action.label} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
