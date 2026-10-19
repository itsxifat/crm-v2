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
      {/* ৳ comes from a fallback font that renders small next to Inter — scale it up. */}
      <span className="mr-[0.18em] align-[-0.04em] text-[1.18em] font-normal leading-none opacity-70">৳</span>
      <span className="tabular-nums">{formatted}</span>
    </span>
  )
}
