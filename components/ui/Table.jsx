import { cn } from '@/lib/utils'

/** shadcn-style table parts. Wrap in a <Card> for the rounded border. */
export function Table({ className, wrapperClassName, ...props }) {
  return (
    <div className={cn('relative w-full overflow-x-auto', wrapperClassName)}>
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-gray-100 [&_tr]:hover:bg-transparent', className)} {...props} />
}

export function TableBody({ className, ...props }) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableFooter({ className, ...props }) {
  return <tfoot className={cn('border-t border-gray-100 bg-gray-50/60 font-medium', className)} {...props} />
}

export function TableRow({ className, ...props }) {
  return <tr className={cn('border-b border-gray-100 transition-colors hover:bg-gray-50/70', className)} {...props} />
}

export function TableHead({ className, ...props }) {
  return (
    <th
      className={cn('h-10 whitespace-nowrap px-4 text-left align-middle text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }) {
  return <td className={cn('px-4 py-3 align-middle text-gray-700', className)} {...props} />
}

export default Table
