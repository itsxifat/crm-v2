import { forwardRef } from 'react'
import Link from 'next/link'
import { cva } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * shadcn-style button. Use `buttonVariants()` to give the same look to a
 * <Link>, <a> or <label>:  className={buttonVariants({ variant: 'outline', size: 'sm' })}
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium',
    'transition-[color,background-color,border-color,box-shadow] outline-none select-none',
    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
    // Disabled buttons keep pointer events so `title` tooltips explaining why still show.
    'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([class*='w-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/25',
        outline:     'border border-input bg-white text-gray-900 shadow-xs hover:bg-accent',
        secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost:       'text-gray-700 hover:bg-accent hover:text-gray-900',
        link:        'h-auto px-0 text-gray-900 underline-offset-4 hover:underline',
        brand:       'bg-brand text-white shadow-xs hover:bg-brand/90',
      },
      size: {
        default:   'h-9 px-4 has-[>svg]:px-3',
        sm:        'h-8 gap-1.5 rounded-md px-3 text-[13px] has-[>svg]:px-2.5',
        xs:        'h-7 gap-1 rounded-md px-2.5 text-xs has-[>svg]:px-2',
        lg:        'h-10 px-6 has-[>svg]:px-4',
        icon:      'size-9',
        'icon-sm': 'size-8 rounded-md',
        'icon-xs': 'size-7 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

const Button = forwardRef(function Button(
  { className, variant, size, href, loading = false, disabled, children, type, ...props },
  ref
) {
  const classes = cn(buttonVariants({ variant, size }), className)
  const content = (
    <>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </>
  )

  if (href && !disabled) {
    return (
      <Link ref={ref} href={href} className={classes} {...props}>
        {content}
      </Link>
    )
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {content}
    </button>
  )
})

export default Button
export { Button }
