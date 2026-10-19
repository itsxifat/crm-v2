'use client'

import { Trash2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import { Label, inputClass, selectClass } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { blank, curSymbol, money, ratesFor } from './quotationUi'

const inputCls  = inputClass
const selectCls = selectClass

/**
 * One editable quotation line: description, venture → category → service,
 * quantity × rate, and (when "Different VAT per line" is on) its VAT %.
 *
 *   line         the live-calculated line from previewQuotation (VAT figures) or undefined
 *   showVatRate  render the per-line VAT % select
 *   vatTreatment the quotation's (effective) VAT treatment — limits the VAT % choices
 *   isVat        show the line's VAT under the amount
 */
export default function QuotationItemCard({
  item, idx, onChange, onRemove, ventures = [], ventureCategories = {}, currency,
  line, showVatRate = false, defaultVatRate = 0, isVat = false, canRemove = true, vatTreatment = 'STANDARD',
}) {
  const venture    = item.venture || ''
  const categories = venture ? Object.keys(ventureCategories[venture] || {}) : []
  const services   = (venture && item.service_category)
    ? (ventureCategories[venture]?.[item.service_category] || [])
    : []

  function upd(field, val) {
    const updated = { ...item, [field]: val }
    if (field === 'venture')          { updated.service_category = ''; updated.service = '' }
    if (field === 'service_category') { updated.service = '' }
    if (field === 'quantity' || field === 'rate') {
      updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0)
    }
    onChange(idx, updated)
  }

  // Only the rates the treatment may carry (+ a stored out-of-range rate, so the
  // validation message makes sense) — STANDARD 15%, REDUCED 0–15% exclusive.
  const rateChoices = [...new Set([...ratesFor(vatTreatment), ...(blank(item.vatRate) ? [] : [Number(item.vatRate)])])]
    .sort((a, b) => a - b)

  return (
    <div className="space-y-3 rounded-lg border border-gray-200/80 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-gray-900">Item {idx + 1}</span>
        {canRemove && (
          <Button variant="ghost" size="icon-xs" onClick={() => onRemove(idx)} aria-label={`Remove item ${idx + 1}`}
            className="text-gray-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 />
          </Button>
        )}
      </div>

      <div>
        <Label>Description</Label>
        <input value={item.description ?? ''} onChange={e => upd('description', e.target.value)}
          placeholder="e.g. Website design" maxLength={2000}
          className={inputCls} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>Venture</Label>
          <select value={item.venture ?? ''} onChange={e => upd('venture', e.target.value)} className={selectCls}>
            <option value="">None</option>
            {ventures.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <Label>Category</Label>
          <select value={item.service_category || ''} onChange={e => upd('service_category', e.target.value)}
            disabled={!categories.length} className={selectCls}>
            <option value="">Select…</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label>Service</Label>
          <select value={item.service || ''} onChange={e => upd('service', e.target.value)}
            disabled={!services.length} className={selectCls}>
            <option value="">Select…</option>
            {services.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className={cn('grid grid-cols-1 gap-3', showVatRate ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <div>
          <Label>Quantity</Label>
          <input type="number" min="0.01" step="any" value={item.quantity} onChange={e => upd('quantity', e.target.value)}
            className={cn(inputCls, 'text-right')} />
        </div>
        <div>
          <Label>Rate ({curSymbol(currency)})</Label>
          <input type="number" min="0" step="any" value={item.rate} onChange={e => upd('rate', e.target.value)}
            placeholder="0" className={cn(inputCls, 'text-right')} />
        </div>
        {showVatRate && (
          <div>
            <Label>VAT %</Label>
            <select value={blank(item.vatRate) ? '' : String(item.vatRate)} onChange={e => upd('vatRate', e.target.value)}
              className={selectCls}>
              <option value="">Default ({defaultVatRate}%)</option>
              {rateChoices.map(r => <option key={r} value={String(r)}>{r}%</option>)}
            </select>
          </div>
        )}
        <div>
          <Label>Amount</Label>
          <div className="flex h-9 w-full items-center justify-end rounded-lg bg-gray-50 px-3 text-sm font-medium tabular-nums text-gray-900">
            {curSymbol(currency)} {money(item.amount)}
          </div>
          {isVat && line && (line.vatAmount > 0 || line.sdAmount > 0) && (
            <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
              {line.sdAmount > 0 && <>SD {money(line.sdAmount)} · </>}VAT {line.vatRate}% · {money(line.vatAmount)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
