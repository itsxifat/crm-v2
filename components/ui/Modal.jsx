'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  className,
}) {
  const sizeMap = {
    sm:   'max-w-sm',
    md:   'max-w-lg',
    lg:   'max-w-2xl',
    xl:   'max-w-4xl',
    full: 'max-w-6xl',
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          onPointerDownOutside={(e) => {
            const orig = e.detail?.originalEvent
            const byTarget = orig?.target?.closest?.('[data-datepicker-popup]')
            const byCoords = orig ? document.elementFromPoint(orig.clientX, orig.clientY)?.closest('[data-datepicker-popup]') : null
            if (byTarget || byCoords || document.querySelector('[data-datepicker-popup]')) e.preventDefault()
          }}
          onFocusOutside={(e) => {
            if (document.querySelector('[data-datepicker-popup]')) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            const orig = e.detail?.originalEvent
            const byTarget = orig?.target?.closest?.('[data-datepicker-popup]')
            const byCoords = orig ? document.elementFromPoint(orig.clientX, orig.clientY)?.closest('[data-datepicker-popup]') : null
            if (byTarget || byCoords || document.querySelector('[data-datepicker-popup]')) e.preventDefault()
          }}
          className={cn(
            'fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]',
            'w-[calc(100%-1.5rem)] sm:w-full rounded-2xl border border-gray-200/80 bg-white shadow-2xl outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200',
            sizeMap[size],
            'max-h-[92vh] sm:max-h-[88vh] flex flex-col',
            className
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-4 sm:px-6 pt-5 pb-3 shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold tracking-tight text-gray-900">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="-mr-1.5 -mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-1 pb-4">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ModalFooter({ children, className }) {
  return (
    // Rendered inside the padded body, so it bleeds to the dialog edges.
    <div className={cn('-mx-4 sm:-mx-6 -mb-4 mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end px-4 sm:px-6 py-3.5 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl shrink-0', className)}>
      {children}
    </div>
  )
}
