'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Paperclip } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { buttonVariants } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { fileExt, fileIcon, formatBytes, isPdf, isPreviewableImage, plural } from './mailUtils'

const inlineUrl = (a) => `${a.url}${a.url.includes('?') ? '&' : '?'}inline=1`

function AttachmentCard({ att, onPreview }) {
  const image = isPreviewableImage(att.contentType)
  const pdf = isPdf(att.contentType, att.filename)
  const Icon = fileIcon(att.contentType, att.filename)
  const ext = fileExt(att.filename)

  const preview = (
    <div className="relative flex h-24 items-center justify-center overflow-hidden border-b border-gray-100 bg-gray-50">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={inlineUrl(att)} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="flex flex-col items-center gap-1.5">
          <Icon className="size-7 text-gray-400" />
          {ext && <span className="text-[10px] font-semibold tracking-wide text-gray-400">{ext}</span>}
        </div>
      )}
    </div>
  )
  const meta = (
    <div className="min-w-0 px-2.5 py-2 text-left">
      <p className="truncate text-xs font-medium text-gray-900" title={att.filename}>{att.filename}</p>
      <p className="mt-0.5 text-2xs text-muted-foreground">{formatBytes(att.size)}</p>
    </div>
  )
  const cardClass = 'block w-full overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

  return (
    <div className="group relative overflow-hidden rounded-lg border border-gray-200/80 bg-white shadow-xs transition-shadow hover:shadow-md">
      {image ? (
        <button type="button" onClick={onPreview} className={cardClass}>{preview}{meta}</button>
      ) : pdf ? (
        <a href={inlineUrl(att)} target="_blank" rel="noopener noreferrer" className={cardClass}>{preview}{meta}</a>
      ) : (
        <a href={att.url} download={att.filename} className={cardClass}>{preview}{meta}</a>
      )}
      <a
        href={att.url}
        download={att.filename}
        aria-label={`Download ${att.filename}`}
        className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-md border border-gray-200/80 bg-white/95 text-gray-600 opacity-0 shadow-xs outline-none transition-opacity hover:text-gray-900 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
      >
        <Download className="size-3.5" />
      </a>
    </div>
  )
}

function Lightbox({ images, index, onIndex, onClose }) {
  const open = index != null && !!images[index]
  const att = open ? images[index] : null

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, index, images.length, onIndex])

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title={att?.filename || 'Image'} size="full">
      {att && (
        <div className="space-y-4">
          <div className="relative flex min-h-[40vh] items-center justify-center rounded-xl bg-gray-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={inlineUrl(att)} alt={att.filename} className="max-h-[68vh] max-w-full rounded-md object-contain" />
            {index > 0 && (
              <button type="button" onClick={() => onIndex(index - 1)} aria-label="Previous image"
                className="absolute left-3 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-sm outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-ring/50">
                <ChevronLeft className="size-4" />
              </button>
            )}
            {index < images.length - 1 && (
              <button type="button" onClick={() => onIndex(index + 1)} aria-label="Next image"
                className="absolute right-3 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-sm outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-ring/50">
                <ChevronRight className="size-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {images.length > 1 && <span className="tabular-nums">{index + 1} / {images.length} · </span>}
              {formatBytes(att.size)}
            </span>
            <a href={att.url} download={att.filename} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Download />
              Download
            </a>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function AttachmentGrid({ attachments = [], className }) {
  const files = attachments.filter(a => !a.inline && a.url)
  const images = files.filter(a => isPreviewableImage(a.contentType))
  const [viewing, setViewing] = useState(null)

  if (!files.length) return null
  const total = files.reduce((s, a) => s + (Number(a.size) || 0), 0)

  return (
    <div className={cn('mt-5', className)}>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Paperclip className="size-3.5" />
        <span>{plural(files.length, 'attachment')}</span>
        <span className="text-gray-300">·</span>
        <span>{formatBytes(total)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
        {files.map(att => (
          <AttachmentCard
            key={att.idx}
            att={att}
            onPreview={() => setViewing(images.findIndex(i => i.idx === att.idx))}
          />
        ))}
      </div>
      <Lightbox images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
    </div>
  )
}
