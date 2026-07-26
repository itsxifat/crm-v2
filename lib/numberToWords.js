// Converts a monetary amount to words for printed documents (salary slips,
// vouchers). International short scale (Hundred/Thousand/Million/Billion) —
// matches the digit grouping already used across the app (TkAmt / en-BD
// locale formatting doesn't use Lakh/Crore grouping either).

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion']

function threeDigitsToWords(n) {
  let s = ''
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} Hundred`
    n %= 100
    if (n) s += ' '
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)]
    if (n % 10) s += `-${ONES[n % 10]}`
  } else if (n > 0) {
    s += ONES[n]
  }
  return s
}

/** Whole-number → words, e.g. 45000 → "Forty-Five Thousand" */
export function integerToWords(num) {
  const n = Math.floor(Math.abs(Number(num) || 0))
  if (n === 0) return 'Zero'

  const chunks = []
  let rem = n
  let scaleIdx = 0
  while (rem > 0) {
    const chunk = rem % 1000
    if (chunk) chunks.unshift(`${threeDigitsToWords(chunk)}${SCALES[scaleIdx] ? ` ${SCALES[scaleIdx]}` : ''}`)
    rem = Math.floor(rem / 1000)
    scaleIdx++
  }
  return chunks.join(' ')
}

const CURRENCY_WORDS = {
  BDT: 'Taka', USD: 'US Dollars', EUR: 'Euros', GBP: 'Pounds Sterling',
  INR: 'Indian Rupees', AUD: 'Australian Dollars', CAD: 'Canadian Dollars',
  SGD: 'Singapore Dollars', AED: 'UAE Dirhams', MYR: 'Malaysian Ringgit',
}
const SUBUNIT_WORDS = { BDT: 'Paisa' }

/** Full amount-in-words for a printed total, e.g. (45000.50, 'BDT') →
 * "Forty-Five Thousand Taka and 50 Paisa Only" */
export function amountToWords(amount, currency = 'BDT') {
  const value       = Number(amount) || 0
  const wholePart   = Math.floor(value)
  const decimalPart = Math.round((value - wholePart) * 100)
  const currencyLabel = CURRENCY_WORDS[currency] ?? currency

  let words = `${integerToWords(wholePart)} ${currencyLabel}`
  if (decimalPart > 0) {
    const subLabel = SUBUNIT_WORDS[currency] ?? 'Cents'
    words += ` and ${integerToWords(decimalPart)} ${subLabel}`
  }
  return `${words} Only`
}
