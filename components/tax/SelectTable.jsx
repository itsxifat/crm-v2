'use client'

import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
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
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="w-10 pr-0">
              <input type="checkbox" className="rounded border-gray-300" checked={allChecked} onChange={toggleAll} disabled={loading || !rows.length} aria-label="Select all" />
            </TableHead>
          )}
          {columns.map(c => (
            <TableHead key={c.key} className={c.className}>{c.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              {selectable && <TableCell className="pr-0"><div className="size-4 animate-pulse rounded bg-gray-100" /></TableCell>}
              {columns.map(c => <TableCell key={c.key}><div className="h-4 animate-pulse rounded-md bg-gray-100" /></TableCell>)}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <td colSpan={columns.length + (selectable ? 1 : 0)}><EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} /></td>
          </TableRow>
        ) : rows.map(row => {
          const isSel = selectable && selected.has(row.id)
          const can = selectable ? (isSel ? true : canSelect(row, selectedRows)) : false
          return (
            <TableRow
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              data-state={isSel ? 'selected' : undefined}
              className={cn(isSel && 'bg-gray-50 hover:bg-gray-50', onRowClick && 'cursor-pointer')}
            >
              {selectable && (
                <TableCell className="pr-0" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 disabled:opacity-30"
                    checked={isSel}
                    disabled={can !== true}
                    title={can !== true && typeof can === 'string' ? can : undefined}
                    onChange={() => toggle(row)}
                    aria-label={`Select ${row.entryNo ?? row.id}`}
                  />
                </TableCell>
              )}
              {columns.map(c => (
                <TableCell key={c.key} className={cn('align-top', c.cellClassName)}>{c.render ? c.render(row) : row[c.key]}</TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** Sticky bar shown while rows are selected. */
export function SelectionBar({ count, amount, onClear, children }) {
  if (!count) return null
  return (
    <div className="sticky bottom-4 z-20 mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-1 text-sm text-gray-700">
          <span><span className="font-semibold text-gray-900 tabular-nums">{count}</span> selected</span>
          {amount != null && <span>· <span className="font-semibold text-gray-900 tabular-nums">{tk(amount)}</span></span>}
          {onClear && <Button variant="ghost" size="xs" onClick={onClear} className="ml-2 text-muted-foreground">Clear</Button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  )
}
