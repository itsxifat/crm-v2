'use client'

import { Phone, PhoneCall } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePhone } from './PhoneProvider'

/** The header's phone button: opens the dialpad, shows whether the phone is online. */
export default function PhoneButton() {
  const phone = usePhone()
  if (!phone) return null
  const { state } = phone
  const call = state.call
  const ringing = call?.direction === 'incoming' && call.state === 'ringing'
  const dot = state.reg === 'registered' ? 'bg-emerald-500' : state.reg === 'failed' ? 'bg-red-500' : 'bg-amber-400'
  const label = ringing ? 'Incoming call' : call ? 'Call in progress' : `Phone (ext ${state.extension})`

  return (
    <button type="button" onClick={phone.togglePanel} aria-label={label} title={label}
      className={cn(
        'relative inline-flex size-9 items-center justify-center rounded-lg transition-colors',
        ringing ? 'animate-pulse bg-emerald-50 text-emerald-600'
          : call ? 'bg-brand-50 text-brand'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
        phone.panelOpen && !call && 'bg-gray-100 text-gray-900',
      )}>
      {call ? <PhoneCall className="size-[18px]" /> : <Phone className="size-[18px]" />}
      <span className={cn('absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-white', dot)} />
    </button>
  )
}
