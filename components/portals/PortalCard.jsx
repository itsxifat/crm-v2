import { cn } from '@/lib/utils'

export default function PortalCard({ children, className = '', padding = true }) {
  return (
    <div className={cn('rounded-xl border border-gray-200/80 bg-white shadow-xs', padding && 'p-5', className)}>
      {children}
    </div>
  )
}
