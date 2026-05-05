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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
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
            'w-[calc(100%-2rem)] sm:w-full bg-white rounded-xl shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
            sizeMap[size],
            'max-h-[95vh] sm:max-h-[90vh] flex flex-col',
            className
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
            <div>
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="text-sm text-gray-500 mt-0.5">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ModalFooter({ children, className }) {
  return (
    <div className={cn('flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl shrink-0', className)}>
      {children}
    </div>
  )
}
