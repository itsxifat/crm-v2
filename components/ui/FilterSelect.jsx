'use client'

import { cn } from '@/lib/utils'
import Select from '@/components/ui/Select'

/**
 * FilterSelect — thin wrapper around Select for filter bars.
 * Passes an empty-string option as "All / clear" automatically.
 */
export default function FilterSelect({ value, onChange, options = [], placeholder = 'All', className }) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      className={cn('min-w-[120px]', className)}
    />
  )
}
