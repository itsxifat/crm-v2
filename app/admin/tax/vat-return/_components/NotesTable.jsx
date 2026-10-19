'use client'

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import {
  VAT_RETURN_LAYOUT, SERVICE_NOTES, noteLabel, noteFormula, isTotalNote, noteValues, noteIsZero,
} from '@/app/api/tax/vat-return/_lib/layout'
import { fmtAmount } from '../_lib/format'

/** Notes with entries behind them (drill-down available). */
function entriesOf(result, n) {
  const rows = result?.noteEntries?.[String(n)]
  return Array.isArray(rows) ? rows : []
}

/**
 * Mushak-9.1 Parts 3–11 with official note numbers and a/b/c columns.
 * Rows with entries are clickable (onDrill(note)). Notes a service business does
 * not use are hidden while zero unless `showAll`.
 */
export default function NotesTable({ result, showAll, onDrill }) {
  const notes = result?.notes ?? {}

  return (
    <div className="space-y-4">
      {VAT_RETURN_LAYOUT.map(part => {
        const visible = part.notes.filter(n => showAll || SERVICE_NOTES.has(n) || !noteIsZero(notes, n))
        if (!visible.length) return null
        return (
          <Card as="section" key={part.part} className="overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle as="h2">{part.title}</CardTitle>
            </CardHeader>
            <Table className="min-w-[560px]" wrapperClassName="border-t border-gray-100">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Note</TableHead>
                  <TableHead className="px-2">Description</TableHead>
                  {part.columns.map(c => (
                    <TableHead key={c.key} className="w-36 text-right">{c.label}</TableHead>
                  ))}
                  <TableHead className="w-8 px-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(n => {
                  const vals = noteValues(notes, n, part.columns)
                  const total = isTotalNote(n)
                  const formula = noteFormula(n)
                  const rows = entriesOf(result, n)
                  const clickable = rows.length > 0
                  const highlight = Number(n) === 50
                  const closing = Number(n) === 65
                  const zero = noteIsZero(notes, n)
                  return (
                    <TableRow
                      key={String(n)}
                      onClick={clickable ? () => onDrill(n) : undefined}
                      className={cn(
                        clickable ? 'cursor-pointer' : 'hover:bg-transparent',
                        total && 'bg-gray-50/70 font-semibold',
                        highlight && 'bg-amber-50/70 font-semibold hover:bg-amber-50',
                        closing && 'bg-emerald-50/70 font-semibold hover:bg-emerald-50',
                      )}
                    >
                      <TableCell className="py-2.5 align-top">
                        <span className={cn(
                          'inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums',
                          highlight ? 'bg-amber-100 text-amber-800' : total ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700',
                        )}>{String(n)}</span>
                      </TableCell>
                      <TableCell className="px-2 py-2.5 align-top">
                        <p className={cn('text-gray-900', zero && !total && 'text-muted-foreground')}>{noteLabel(n)}</p>
                        {formula && <p className="mt-0.5 text-xs font-normal text-muted-foreground">{formula}</p>}
                        {clickable && <p className="mt-0.5 text-xs font-medium text-gray-500">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>}
                      </TableCell>
                      {part.columns.map(c => (
                        <TableCell key={c.key} className={cn('whitespace-nowrap py-2.5 text-right align-top tabular-nums', zero ? 'text-gray-400' : 'text-gray-900')}>
                          {fmtAmount(vals[c.key])}
                        </TableCell>
                      ))}
                      <TableCell className="px-0 py-2.5 pr-3 align-top">
                        {clickable && <ChevronRight className="size-4 text-gray-400" />}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )
      })}
    </div>
  )
}
