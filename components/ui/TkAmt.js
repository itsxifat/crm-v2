'use client'

/**
 * Renders a Taka amount with a styled ৳ symbol.
 * Usage: <TkAmt value={5000} /> → ৳ 5,000
 */
export default function TkAmt({ value, decimals = 0, className = '' }) {
  const num = (value == null || value === '') ? 0 : Number(value)
  const formatted = num.toLocaleString('en-BD', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return (
    <span className={className}>
      <span style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: '1.05em', letterSpacing: '-0.5px' }}>৳</span>
      {'\u00A0'}{formatted}
    </span>
  )
}
