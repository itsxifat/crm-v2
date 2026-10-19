'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import EmptyState from './EmptyState'

export default function DataTable({
  columns,
  data = [],
  loading = false,
  emptyTitle = 'No data found',
  emptyDescription,
  emptyIcon,
  className,
  onRowClick,
}) {
  const [sortKey, setSortKey]     = useState(null)
  const [sortDir, setSortDir]     = useState('asc')

  const handleSort = (key) => {
    if (!key) return
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedData = [...data].sort((a, b) => {
    if (!sortKey) return 0
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    if (aVal == null) return 1
    if (bVal == null) return -1
    const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className={cn('overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {columns.map((col) => (
                <th
                  key={col.key ?? col.label}
                  className={cn(
                    'h-10 px-4 text-left align-middle text-xs font-medium text-muted-foreground whitespace-nowrap',
                    col.sortable && 'cursor-pointer select-none hover:text-gray-900',
                    col.className
                  )}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center gap-1.5">
                    {col.label}
                    {col.sortable && (
                      <span className="text-gray-400">
                        {sortKey === col.key ? (
                          sortDir === 'asc' ? (
                            <ChevronUp className="size-3.5 text-gray-900" />
                          ) : (
                            <ChevronDown className="size-3.5 text-gray-900" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5" />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key ?? col.label} className="px-4 py-3">
                      <div className="h-4 rounded-md bg-gray-100 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    icon={emptyIcon}
                    title={emptyTitle}
                    description={emptyDescription}
                  />
                </td>
              </tr>
            ) : (
              sortedData.map((row, rowIdx) => (
                <tr
                  key={row.id ?? rowIdx}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    'group transition-colors hover:bg-gray-50/70',
                    onRowClick && 'cursor-pointer'
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key ?? col.label} className={cn('px-4 py-3 align-middle text-gray-700', col.cellClassName)}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
