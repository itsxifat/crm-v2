'use client'

import { inputClass } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { curSymbol, money } from './quotationUi'

const smallInput = cn(inputClass, 'h-8 w-24 px-2 text-right')

/**
 * Live totals for the quotation forms: subtotal, discount, taxable value, SD,
 * VAT, MFS charge and total, plus the "item-wise prices only" switch.
 *
 *   preview        previewQuotation(...) result
 *   vatRowLabel    "VAT (15%)" etc.
 *   pendingDefault the VAT treatment will be applied by the server on save
 */
export default function QuotationTotals({
  preview, currency, isVat, vatRowLabel,
  taxRate, onTaxRate, discount, onDiscount,
  itemPriceOnly, onItemPriceOnly, pendingDefault = false,
}) {
  const { subtotal, taxAmount, total } = preview
  const sym = curSymbol(currency)
  const issues = (preview.issues ?? []).filter(m => m !== 'At least one item required')

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="font-medium tabular-nums text-gray-900">{sym} {money(subtotal)}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="whitespace-nowrap text-sm text-muted-foreground" htmlFor="q-discount"
          title={isVat ? 'Reduces the VAT base.' : undefined}>
          Discount ({sym})
        </label>
        <input id="q-discount" type="number" min="0" step="any" value={discount}
          title={isVat ? 'Reduces the VAT base.' : undefined}
          onChange={e => onDiscount(e.target.value)} className={smallInput} />
      </div>

      {isVat && (
        <>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Taxable value</span><span className="tabular-nums text-gray-700">{sym} {money(preview.taxableValue)}</span>
          </div>
          {preview.sdAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Supplementary duty (SD)</span><span className="tabular-nums text-gray-700">{sym} {money(preview.sdAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{vatRowLabel}</span><span className="tabular-nums text-gray-700">{sym} {money(preview.vatAmount)}</span>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="whitespace-nowrap text-sm text-muted-foreground" htmlFor="q-mfs">MFS charge (%)</label>
          <p className="text-[11px] text-muted-foreground">Mobile-payment surcharge, not VAT</p>
        </div>
        <input id="q-mfs" type="number" min="0" max="100" step="any" value={taxRate}
          onChange={e => onTaxRate(e.target.value)} className={smallInput} />
      </div>
      {taxAmount > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">MFS charge ({Number(taxRate) || 0}%)</span><span className="tabular-nums text-gray-700">{sym} {money(taxAmount)}</span>
        </div>
      )}

      <div className="flex justify-between border-t border-gray-100 pt-3">
        <span className="text-sm font-semibold text-gray-900">Total</span>
        <span className="text-base font-semibold tabular-nums text-gray-900">{sym} {money(total)}</span>
      </div>

      {pendingDefault && (
        <p className="text-xs text-muted-foreground">Company-default VAT, if any, is added on save.</p>
      )}
      {issues.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          {issues.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}

      <label className="flex cursor-pointer select-none items-start gap-2 pt-2">
        <input type="checkbox" checked={itemPriceOnly} onChange={e => onItemPriceOnly(e.target.checked)}
          className="mt-0.5 size-4 cursor-pointer rounded border-gray-300" />
        <span className="text-[13px] text-gray-700">Item-wise prices only <span className="text-muted-foreground">(hides total on PDF)</span></span>
      </label>
    </div>
  )
}
