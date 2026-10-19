'use client'

/**
 * Renders a Taka amount with a styled ৳ symbol.
 * Usage: <TkAmt value={5000} /> → ৳ 5,000
 */
export default function TkAmt({ value, decimals = 0, className = '' }) {
  // Masked money from the PII layer ('••••••') is shown as-is, not 'NaN'.
  const masked = typeof value === 'string' && value.includes('••')
  const num = (value == null || value === '') ? 0 : Number(value)
  const formatted = masked ? value : num.toLocaleString('en-BD', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return (
    <span className={className}>
      {/* ৳ is drawn by Anek Bangla (see app/layout.js), matching weight with the digits. */}
      <span className="mr-[0.22em]">৳</span>
      <span className="tabular-nums">{formatted}</span>
    </span>
  )
}
