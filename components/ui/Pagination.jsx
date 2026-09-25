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
    const delta = 2
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

  return (
    <div className="flex items-center justify-between">
      {hasRange ? (
        <p className="text-sm text-gray-500">
          Showing <span className="font-medium text-gray-700">{from}</span>–<span className="font-medium text-gray-700">{to}</span> of <span className="font-medium text-gray-700">{total}</span> results
        </p>
      ) : (
        <p className="text-sm text-gray-500">Page {page} of {pages}</p>
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className={cn(
            'p-2 rounded-lg border text-sm font-medium transition-colors',
            page === 1
              ? 'border-gray-100 text-gray-300 cursor-not-allowed'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
          )}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {getPageNumbers().map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-2 py-2 text-gray-400">
              <MoreHorizontal className="w-4 h-4" />
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={cn(
                'min-w-[36px] h-9 px-2 rounded-lg border text-sm font-medium transition-colors',
                p === page
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
              )}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === pages}
          className={cn(
            'p-2 rounded-lg border text-sm font-medium transition-colors',
            page === pages
              ? 'border-gray-100 text-gray-300 cursor-not-allowed'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
          )}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
