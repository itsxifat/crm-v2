import { cn } from '@/lib/utils'

/** Rounded, bordered surface. Compose with the parts below or pad it yourself. */
export function Card({ className, as: Tag = 'div', ...props }) {
  return (
    <Tag
      className={cn('rounded-xl border border-gray-200/80 bg-card text-card-foreground shadow-xs', className)}
      {...props}
    />
  )
}

/** Title row. Put a <CardAction> (button/link) next to the title block. */
export function CardHeader({ className, ...props }) {
  return <div className={cn('flex items-start justify-between gap-3 px-5 pt-5 pb-4', className)} {...props} />
}

export function CardTitle({ className, as: Tag = 'h3', ...props }) {
  return <Tag className={cn('text-sm font-semibold leading-5 tracking-tight text-gray-900', className)} {...props} />
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('mt-0.5 text-[13px] text-muted-foreground', className)} {...props} />
}

export function CardAction({ className, ...props }) {
  return <div className={cn('flex shrink-0 items-center gap-2', className)} {...props} />
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center gap-2 border-t border-gray-100 px-5 py-3', className)} {...props} />
}

export default Card
