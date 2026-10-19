'use client'

import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import EmptyState from '@/components/ui/EmptyState'
import { tk } from './taxUi'

/**
 * Table with row checkboxes (DataTable has no selection).
 *
 * Props:
 *   columns       [{ key, label, render?(row), className?, cellClassName? }]
 *   rows          array (each with `id`)
 *   selected      Set of ids (omit to hide checkboxes)
 *   onChange(set) new selection
 *   canSelect(row, selectedRows) → true | string (reason shown as tooltip when not selectable)
 *   loading, emptyTitle, emptyDescription, emptyIcon, onRowClick
 */
export default function SelectTable({
  columns, rows = [], selected = null, onChange, canSelect = () => true,
  loading = false, emptyTitle = 'Nothing here', emptyDescription, emptyIcon = Inbox, onRowClick,
}) {
  const selectable = selected instanceof Set
  const selectedRows = selectable ? rows.filter(r => selected.has(r.id)) : []
  const eligible = selectable ? rows.filter(r => selected.has(r.id) || canSelect(r, selectedRows) === true) : []
  const allChecked = selectable && eligible.length > 0 && eligible.every(r => selected.has(r.id))

  function toggle(row) {
    const next = new Set(selected)
    if (next.has(row.id)) next.delete(row.id)
    else next.add(row.id)
    onChange?.(next)
  }

  function toggleAll() {
    if (allChecked) { onChange?.(new Set()); return }
    // Select every row compatible with the current selection (or with the first row when empty).
    const next = new Set(selected)
    let base = rows.filter(r => next.has(r.id))
    for (const r of rows) {
      if (next.has(r.id)) continue
      if (canSelect(r, base) === true) { next.add(r.id); base = [...base, r] }
    }
    onChange?.(next)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            {selectable && (
              <th className="w-10 px-3 py-3">
                <input type="checkbox" className="rounded border-gray-300" checked={allChecked} onChange={toggleAll} disabled={loading || !rows.length} aria-label="Select all" />
              </th>
            )}
            {columns.map(c => (
              <th key={c.key} className={cn('px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap', c.className)}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {selectable && <td className="px-3 py-3"><div className="h-4 w-4 rounded bg-gray-100 animate-pulse" /></td>}
                {columns.map(c => <td key={c.key} className="px-3 py-3"><div className="h-4 rounded bg-gray-100 animate-pulse" /></td>)}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={columns.length + (selectable ? 1 : 0)}><EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} /></td></tr>
          ) : rows.map(row => {
            const isSel = selectable && selected.has(row.id)
            const can = selectable ? (isSel ? true : canSelect(row, selectedRows)) : false
            return (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('transition-colors', isSel ? 'bg-blue-50/50' : 'hover:bg-gray-50/70', onRowClick && 'cursor-pointer')}
              >
                {selectable && (
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 disabled:opacity-30"
                      checked={isSel}
                      disabled={can !== true}
                      title={can !== true && typeof can === 'string' ? can : undefined}
                      onChange={() => toggle(row)}
                      aria-label={`Select ${row.entryNo ?? row.id}`}
                    />
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key} className={cn('px-3 py-2.5 text-gray-700 align-top', c.cellClassName)}>{c.render ? c.render(row) : row[c.key]}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Sticky bar shown while rows are selected. */
export function SelectionBar({ count, amount, onClear, children }) {
  if (!count) return null
  return (
    <div className="sticky bottom-4 z-20 mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900">{count}</span> selected
          {amount != null && <> · <span className="font-semibold text-gray-900">{tk(amount)}</span></>}
          {onClear && <button type="button" onClick={onClear} className="ml-3 text-xs text-gray-500 underline hover:text-gray-800">Clear</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  )
}
