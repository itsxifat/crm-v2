'use client'

import { Trash2 } from 'lucide-react'
import { blank, curSymbol, money, ratesFor } from './quotationUi'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent'
const labelCls = 'block text-xs text-gray-500 mb-1 font-medium'

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
    <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50/50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Item {idx + 1}</span>
        {canRemove && (
          <button type="button" onClick={() => onRemove(idx)} aria-label={`Remove item ${idx + 1}`}
            className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <input value={item.description ?? ''} onChange={e => upd('description', e.target.value)}
          placeholder="Describe the service or deliverable…" maxLength={2000}
          className={inputCls} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Venture</label>
          <select value={item.venture ?? ''} onChange={e => upd('venture', e.target.value)} className={inputCls}>
            <option value="">None</option>
            {ventures.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select value={item.service_category || ''} onChange={e => upd('service_category', e.target.value)}
            disabled={!categories.length} className={inputCls + (categories.length ? '' : ' opacity-40 cursor-not-allowed')}>
            <option value="">— Category —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Service</label>
          <select value={item.service || ''} onChange={e => upd('service', e.target.value)}
            disabled={!services.length} className={inputCls + (services.length ? '' : ' opacity-40 cursor-not-allowed')}>
            <option value="">— Service —</option>
            {services.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${showVatRate ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <div>
          <label className={labelCls}>Quantity</label>
          <input type="number" min="0.01" step="any" value={item.quantity} onChange={e => upd('quantity', e.target.value)}
            className={inputCls + ' text-right'} />
        </div>
        <div>
          <label className={labelCls}>Rate ({curSymbol(currency)})</label>
          <input type="number" min="0" step="any" value={item.rate} onChange={e => upd('rate', e.target.value)}
            placeholder="0" className={inputCls + ' text-right'} />
        </div>
        {showVatRate && (
          <div>
            <label className={labelCls}>VAT %</label>
            <select value={blank(item.vatRate) ? '' : String(item.vatRate)} onChange={e => upd('vatRate', e.target.value)}
              className={inputCls}>
              <option value="">Default ({defaultVatRate}%)</option>
              {rateChoices.map(r => <option key={r} value={String(r)}>{r}%</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={labelCls}>Amount</label>
          <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-right font-semibold text-gray-800 tabular-nums">
            {curSymbol(currency)} {money(item.amount)}
          </div>
          {isVat && line && (line.vatAmount > 0 || line.sdAmount > 0) && (
            <p className="text-[11px] text-gray-400 text-right mt-1 tabular-nums">
              {line.sdAmount > 0 && <>SD {money(line.sdAmount)} · </>}VAT {line.vatRate}% · {money(line.vatAmount)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
