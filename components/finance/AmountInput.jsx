'use client'

import { cn } from '@/lib/utils'
import { CURRENCIES } from '@/lib/currencies'
import { INPUT, INPUT_ERR } from './accountTheme'

/**
 * Text input for money: decimal keyboard on mobile, currency prefix, commas
 * tolerated ('1,25,000.50'). `value` is the raw string the user typed; parse it
 * with parseAmount() from accountTheme.
 */
export default function AmountInput({
  value, onChange, currency = 'BDT', placeholder = '0.00', disabled, error, className, id, allowNegative = false, autoFocus,
}) {
  const symbol = CURRENCIES.find(c => c.code === currency)?.symbol ?? currency
  const handle = (e) => {
    const raw = e.target.value
    const re = allowNegative ? /^-?[\d,]*\.?\d{0,2}$/ : /^[\d,]*\.?\d{0,2}$/
    if (raw === '' || re.test(raw)) onChange?.(raw)
  }
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">
        {symbol}
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value ?? ''}
        onChange={handle}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? 'true' : undefined}
        className={cn(INPUT, 'text-right tabular-nums', symbol.length > 2 ? 'pl-12' : 'pl-8', error && INPUT_ERR)}
      />
    </div>
  )
}
