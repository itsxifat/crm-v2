// Currencies the business can transact in. BDT is the home/base currency — all
// finance metrics roll up in BDT, and every non-BDT transaction also records a
// manually-entered BDT-equivalent of what was actually spent/received.
export const BASE_CURRENCY = 'BDT'

export const CURRENCIES = [
  { code: 'BDT', label: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'USD', label: 'US Dollar',        symbol: '$' },
  { code: 'EUR', label: 'Euro',             symbol: '€' },
  { code: 'GBP', label: 'British Pound',    symbol: '£' },
  { code: 'INR', label: 'Indian Rupee',     symbol: '₹' },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', label: 'Canadian Dollar',  symbol: 'C$' },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$' },
  { code: 'AED', label: 'UAE Dirham',       symbol: 'د.إ' },
  { code: 'MYR', label: 'Malaysian Ringgit', symbol: 'RM' },
]

export const CURRENCY_CODES = CURRENCIES.map(c => c.code)

export const currencyOptions = CURRENCIES.map(c => ({ value: c.code, label: `${c.code} — ${c.label}` }))

export function isValidCurrency(code) {
  return CURRENCY_CODES.includes(code)
}
