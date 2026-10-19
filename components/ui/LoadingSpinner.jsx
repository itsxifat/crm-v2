import { cn } from '@/lib/utils'

export default function LoadingSpinner({ size = 'md', className }) {
  const sizeMap = {
    sm:  'size-4 border-2',
    md:  'size-6 border-2',
    lg:  'size-8 border-[2.5px]',
    xl:  'size-10 border-[3px]',
  }

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div
        className={cn(
          'rounded-full border-gray-200 border-t-gray-900 animate-spin',
          sizeMap[size] ?? sizeMap.md
        )}
      />
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  )
}
