'use client'

import { Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePhone } from './PhoneProvider'

/**
 * Calls the number stored on a record through the CRM's phone. Names the record, not
 * the number, so it works where the number is shown masked:
 *
 *   <CallButton target={{ type: 'lead', id, field: 'phone' }} label={lead.name} />
 *
 * Renders nothing for people without a phone (no Envo extension) or without a number.
 */
export default function CallButton({ target, label, hasNumber = true, className, size = 'sm' }) {
  const phone = usePhone()
  if (!phone || !hasNumber || !target?.id) return null
  const busy = !!phone.state.call
  const title = busy ? 'Finish the current call first' : `Call${label ? ` ${label}` : ''}`
  return (
    <button type="button" title={title} aria-label={title} disabled={busy}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); phone.callTarget(target, label) }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-emerald-700 ring-1 ring-inset ring-emerald-600/20 transition-colors',
        'bg-emerald-50 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'size-7' : 'size-6',
        className,
      )}>
      <Phone className={size === 'sm' ? 'size-3.5' : 'size-3'} />
    </button>
  )
}
