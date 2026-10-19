import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Page title row. Keep `description` to a few words (or omit it).
 *   <PageHeader title="Invoices" actions={<Button>New invoice</Button>} />
 */
export default function PageHeader({ title, description, actions, back, backLabel = 'Back', meta, className, children }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {back && (
          <Link
            href={back}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900"
          >
            <ArrowLeft className="size-3.5" />
            {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export { PageHeader }
