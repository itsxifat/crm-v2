'use client'

import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { btnPrimary, btnSecondary, labelsUrl, openPrint } from './shared'

const SIZES = {
  small: { cols: 3, rows: 8, title: 'Small — 24 per sheet', sub: '63.5 × 33.9 mm (Avery L7159 / J8159)' },
  large: { cols: 2, rows: 4, title: 'Large — 8 per sheet', sub: '99.1 × 67.7 mm (Avery L7165 / J8165)' },
}

/** Choose label size and the first free position on a part-used sheet, then open the print sheet. */
export default function LabelPrintModal({ open, onOpenChange, ids = [] }) {
  const [size, setSize] = useState('small')
  const [skip, setSkip] = useState(0)

  useEffect(() => { if (open) setSkip(0) }, [open])
  useEffect(() => { setSkip(0) }, [size])

  const L = SIZES[size]
  const perSheet = L.cols * L.rows
  const sheets = Math.max(1, Math.ceil((ids.length + skip) / perSheet))

  function print() {
    openPrint(labelsUrl(ids, { size, skip }))
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="md" title={`Print ${ids.length} label${ids.length === 1 ? '' : 's'}`}
      description="Each label carries the asset tag and a QR code that opens the asset from any phone camera.">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(SIZES).map(([k, s]) => (
            <button key={k} type="button" onClick={() => setSize(k)}
              className={cn('text-left rounded-xl border px-3 py-2.5', size === k ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200 hover:bg-gray-50')}>
              <span className="block text-sm font-medium text-gray-900">{s.title}</span>
              <span className="block text-xs text-gray-500">{s.sub}</span>
            </button>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Start at position (for a part-used sheet)</p>
          <div className="inline-grid gap-1 p-2 bg-gray-50 rounded-lg" style={{ gridTemplateColumns: `repeat(${L.cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: perSheet }).map((_, i) => (
              <button key={i} type="button" onClick={() => setSkip(i)} aria-label={`Start at position ${i + 1}`}
                className={cn('rounded border text-[10px] leading-none', size === 'small' ? 'w-10 h-5' : 'w-16 h-9',
                  i < skip ? 'bg-gray-200 border-gray-200 text-gray-400' : i < skip + ids.length ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-300')}>
                {i + 1}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {skip ? `${skip} position${skip === 1 ? '' : 's'} left blank · ` : ''}{sheets} sheet{sheets === 1 ? '' : 's'} · print at 100% (“Actual size”).
          </p>
        </div>
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
        <button type="button" className={btnSecondary} onClick={() => onOpenChange(false)}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={print} disabled={!ids.length}>
          <Printer className="w-4 h-4" /> Open print sheet
        </button>
      </ModalFooter>
    </Modal>
  )
}
