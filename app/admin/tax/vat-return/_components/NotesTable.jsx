'use client'

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
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
          <section key={part.part} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <h2 className="text-sm font-semibold text-gray-900">{part.title}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-xs text-gray-500">
                    <th className="text-left font-medium px-4 py-2 w-14">Note</th>
                    <th className="text-left font-medium px-2 py-2">Description</th>
                    {part.columns.map(c => (
                      <th key={c.key} className="text-right font-medium px-4 py-2 w-36">{c.label}</th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
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
                      <tr
                        key={String(n)}
                        onClick={clickable ? () => onDrill(n) : undefined}
                        className={cn(
                          'border-t border-gray-50',
                          clickable && 'cursor-pointer hover:bg-blue-50/40',
                          total && 'bg-gray-50/70 font-semibold',
                          highlight && 'bg-amber-50 font-bold',
                          closing && 'bg-emerald-50 font-semibold',
                        )}
                      >
                        <td className="px-4 py-2 align-top">
                          <span className={cn(
                            'inline-flex items-center justify-center min-w-[2rem] h-6 px-1.5 rounded-md text-xs font-semibold',
                            highlight ? 'bg-amber-200 text-amber-900' : total ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700',
                          )}>{String(n)}</span>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <p className={cn('text-gray-800', zero && !total && 'text-gray-500')}>{noteLabel(n)}</p>
                          {formula && <p className="text-[11px] text-gray-400 font-normal mt-0.5">{formula}</p>}
                          {clickable && <p className="text-[11px] text-blue-600 font-normal mt-0.5">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>}
                        </td>
                        {part.columns.map(c => (
                          <td key={c.key} className={cn('px-4 py-2 text-right tabular-nums whitespace-nowrap align-top', zero ? 'text-gray-400' : 'text-gray-900')}>
                            {fmtAmount(vals[c.key])}
                          </td>
                        ))}
                        <td className="pr-3 align-top py-2">
                          {clickable && <ChevronRight className="w-4 h-4 text-gray-400" />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
