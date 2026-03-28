'use client'

import { useState } from 'react'
import { cn, getInitials } from '@/lib/utils'

const sizeStyles = {
  xs:  'w-6 h-6 text-xs',
  sm:  'w-8 h-8 text-xs',
  md:  'w-10 h-10 text-sm',
  lg:  'w-12 h-12 text-base',
  xl:  'w-16 h-16 text-lg',
  '2xl': 'w-20 h-20 text-xl',
}

const colorVariants = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-red-500',
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
      <div className={cn('relative rounded-full overflow-hidden shrink-0', sizeClass, className)}>
        <img
          src={src}
          alt={name}
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-full shrink-0 flex items-center justify-center font-semibold text-white',
        sizeClass,
        color,
        className
      )}
    >
      {initials || '?'}
    </div>
  )
}
