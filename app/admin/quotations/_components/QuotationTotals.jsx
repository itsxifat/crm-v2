'use client'

import { curSymbol, money } from './quotationUi'

const smallInput = 'w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900'

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
      <div className="flex justify-between text-sm text-gray-600">
        <span>Subtotal</span><span className="font-medium tabular-nums">{sym} {money(subtotal)}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="text-sm text-gray-600 whitespace-nowrap" htmlFor="q-discount">Discount ({sym})</label>
          {isVat && <p className="text-[11px] text-gray-400">Reduces the VAT base.</p>}
        </div>
        <input id="q-discount" type="number" min="0" step="any" value={discount}
          onChange={e => onDiscount(e.target.value)} className={smallInput} />
      </div>

      {isVat && (
        <>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Taxable value</span><span className="tabular-nums">{sym} {money(preview.taxableValue)}</span>
          </div>
          {preview.sdAmount > 0 && (
            <div className="flex justify-between text-sm text-gray-500">
              <span>Supplementary duty (SD)</span><span className="tabular-nums">{sym} {money(preview.sdAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-gray-500">
            <span>{vatRowLabel}</span><span className="tabular-nums">{sym} {money(preview.vatAmount)}</span>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="text-sm text-gray-600 whitespace-nowrap" htmlFor="q-mfs">MFS Charge (%)</label>
          <p className="text-[11px] text-gray-400">Mobile-payment surcharge — not VAT</p>
        </div>
        <input id="q-mfs" type="number" min="0" max="100" step="any" value={taxRate}
          onChange={e => onTaxRate(e.target.value)} className={smallInput} />
      </div>
      {taxAmount > 0 && (
        <div className="flex justify-between text-sm text-gray-500">
          <span>MFS Charge ({Number(taxRate) || 0}%)</span><span className="tabular-nums">{sym} {money(taxAmount)}</span>
        </div>
      )}

      <div className="border-t border-gray-100 pt-3 flex justify-between">
        <span className="text-sm font-semibold text-gray-700">Total</span>
        <span className="text-base font-bold text-gray-900 tabular-nums">{sym} {money(total)}</span>
      </div>

      {pendingDefault && (
        <p className="text-xs text-gray-400">VAT, if any, is added on save from the company default.</p>
      )}
      {issues.length > 0 && (
        <ul className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 space-y-0.5">
          {issues.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}

      <label className="flex items-start gap-2 pt-2 cursor-pointer select-none">
        <input type="checkbox" checked={itemPriceOnly} onChange={e => onItemPriceOnly(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900 cursor-pointer" />
        <span className="text-xs text-gray-600">Send price item-wise only <span className="text-gray-400">(hide total on PDF)</span></span>
      </label>
    </div>
  )
}
