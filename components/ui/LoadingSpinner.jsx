import { cn } from '@/lib/utils'

export default function LoadingSpinner({ size = 'md', className }) {
  const sizeMap = {
    sm:  'w-4 h-4 border-2',
    md:  'w-8 h-8 border-2',
    lg:  'w-12 h-12 border-[3px]',
    xl:  'w-16 h-16 border-4',
  }

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div
        className={cn(
          'rounded-full border-gray-200 border-t-blue-500 animate-spin',
          sizeMap[size] ?? sizeMap.md
        )}
      />
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <LoadingSpinner size="lg" />
    </div>
  )
}
