'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cn, getInitials } from '@/lib/utils'

const sizeStyles = {
  xs:  'w-6 h-6 text-[10px]',
  sm:  'w-8 h-8 text-xs',
  md:  'w-10 h-10 text-sm',
  lg:  'w-12 h-12 text-base',
  xl:  'w-16 h-16 text-lg',
  '2xl': 'w-20 h-20 text-xl',
}

const colorVariants = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-pink-100 text-pink-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-rose-100 text-rose-700',
]

function getColorFromName(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colorVariants[Math.abs(hash) % colorVariants.length]
}

export default function Avatar({ src, name = '', size = 'md', className }) {
  const sizeClass       = sizeStyles[size] ?? sizeStyles.md
  const initials        = getInitials(name)
  const color           = getColorFromName(name)
  const [imgError, setImgError] = useState(false)

  if (src && !imgError) {
    return (
      <div className={cn('relative rounded-full overflow-hidden shrink-0 ring-1 ring-black/5', sizeClass, className)}>
        <Image
          src={src}
          alt={name}
          width={40}
          height={40}
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-full shrink-0 flex items-center justify-center font-semibold ring-1 ring-inset ring-black/5',
        sizeClass,
        color,
        className
      )}
    >
      {initials || '?'}
    </div>
  )
}
