'use client'

import { File, FileArchive, FileImage, FileSpreadsheet, FileText, RotateCw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBytes } from './composeUtils'

function iconFor(type = '', name = '') {
  const ext = String(name).split('.').pop()?.toLowerCase()
  if (type.startsWith('image/')) return FileImage
  if (type === 'application/pdf' || ['doc', 'docx', 'txt', 'rtf', 'odt', 'md'].includes(ext)) return FileText
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || type.includes('spreadsheet')) return FileSpreadsheet
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext) || type.includes('zip')) return FileArchive
  return File
}

export default function AttachmentChips({ items, onRemove, onRetry, className }) {
  if (!items?.length) return null
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {items.map((a) => {
        const Icon = iconFor(a.contentType, a.filename)
        const uploading = a.status === 'uploading'
        const failed = a.status === 'error'
        return (
          <div
            key={a.key}
            title={failed ? a.error || 'Upload failed' : a.filename}
            className={cn(
              'relative flex w-[212px] max-w-full items-center gap-2 overflow-hidden rounded-lg border bg-white py-1.5 pl-2.5 pr-1',
              failed ? 'border-red-200 bg-red-50/40' : 'border-gray-200'
            )}
          >
            <Icon className={cn('size-4 shrink-0', failed ? 'text-red-400' : 'text-gray-400')} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-gray-900">{a.filename}</div>
              <div className={cn('truncate text-xs tabular-nums', failed ? 'text-red-600' : 'text-gray-500')}>
                {uploading ? `${Math.round((a.progress || 0) * 100)}%` : failed ? (a.error || 'Upload failed') : formatBytes(a.size)}
              </div>
            </div>
            {failed && a.file && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(a.key)}
                aria-label="Retry upload"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                <RotateCw className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(a.key)}
              aria-label={`Remove ${a.filename}`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900"
            >
              <X className="size-3.5" />
            </button>
            {uploading && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gray-100">
                <div className="h-full bg-gray-900 transition-[width] duration-200" style={{ width: `${Math.max(3, (a.progress || 0) * 100)}%` }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
