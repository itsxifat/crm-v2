'use client'

import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Label } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { labelsUrl, openPrint } from './shared'

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
      description="Each label has the asset tag and a QR code.">
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(SIZES).map(([k, s]) => (
            <button key={k} type="button" onClick={() => setSize(k)} aria-pressed={size === k}
              className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors',
                size === k ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200/80 hover:bg-gray-50')}>
              <span className="block text-sm font-medium text-gray-900">{s.title}</span>
              <span className="block text-xs text-muted-foreground">{s.sub}</span>
            </button>
          ))}
        </div>
        <div>
          <Label title="For a part-used sheet">Start position</Label>
          <div className="inline-grid gap-1 rounded-lg bg-gray-50 p-2" style={{ gridTemplateColumns: `repeat(${L.cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: perSheet }).map((_, i) => (
              <button key={i} type="button" onClick={() => setSkip(i)} aria-label={`Start at position ${i + 1}`}
                className={cn('rounded border text-[11px] leading-none', size === 'small' ? 'h-5 w-10' : 'h-9 w-16',
                  i < skip ? 'border-gray-200 bg-gray-200 text-gray-400' : i < skip + ids.length ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-300')}>
                {i + 1}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {skip ? `${skip} position${skip === 1 ? '' : 's'} left blank · ` : ''}{sheets} sheet{sheets === 1 ? '' : 's'} · print at 100% (“Actual size”).
          </p>
        </div>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={print} disabled={!ids.length}>
          <Printer /> Print labels
        </Button>
      </ModalFooter>
    </Modal>
  )
}
