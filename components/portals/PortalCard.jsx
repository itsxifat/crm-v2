export default function PortalCard({ children, className = '', padding = true }) {
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${padding ? 'p-6' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
