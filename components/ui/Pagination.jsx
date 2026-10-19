'use client'

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function Pagination({ page: pageProp, pages: pagesProp, total: totalProp, limit: limitProp, meta, onPageChange: onPageChangeProp, onChange }) {
  // Accept either explicit props or an API `meta` object ({ page, pages, total, limit }),
  // and `onChange` as an alias of `onPageChange`.
  const page         = Number(pageProp ?? meta?.page ?? 1) || 1
  const pages        = Number(pagesProp ?? meta?.pages ?? 1) || 1
  const total        = totalProp ?? meta?.total
  const limit        = limitProp ?? meta?.limit
  const onPageChange = (p) => {
    if (p < 1 || p > pages || p === page) return
    ;(onPageChangeProp ?? onChange)?.(p)
  }

  if (pages <= 1) return null

  const getPageNumbers = () => {
    const delta = 1
    const range = []
    for (let i = Math.max(2, page - delta); i <= Math.min(pages - 1, page + delta); i++) {
      range.push(i)
    }

    if (page - delta > 2) range.unshift('...')
    if (page + delta < pages - 1) range.push('...')

    range.unshift(1)
    if (pages > 1) range.push(pages)

    return range
  }

  const hasRange = Number.isFinite(Number(total)) && Number(limit) > 0
  const from = hasRange ? (page - 1) * limit + 1 : 0
  const to   = hasRange ? Math.min(page * limit, total) : 0

  const navBtn = 'inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-40'

  return (
    <div className="flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
      <p className="text-[13px] text-muted-foreground tabular-nums">
        {hasRange ? <>{from}–{to} of {total}</> : <>Page {page} of {pages}</>}
      </p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className={navBtn} aria-label="Previous page">
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        {getPageNumbers().map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="inline-flex size-8 items-center justify-center text-gray-400">
              <MoreHorizontal className="size-4" />
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md text-[13px] font-medium tabular-nums transition-colors',
                p === page
                  ? 'border border-gray-200 bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              {p}
            </button>
          )
        )}

        <button onClick={() => onPageChange(page + 1)} disabled={page === pages} className={navBtn} aria-label="Next page">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}
