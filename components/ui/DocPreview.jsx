'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn, ZoomOut, RotateCw, Download, X, FileText, Maximize2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── File type detection ───────────────────────────────────────────────────────
function getFileType(url) {
  if (!url) return 'unknown'
  // Strip query string for extension check
  const path  = url.split('?')[0].toLowerCase()
  const ext   = path.split('.').pop()

  if (['jpg','jpeg','png','gif','webp','bmp','svg','avif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'

  // Cloudinary-style URLs: /image/upload/ in path → image
  if (url.includes('/image/upload/')) return 'image'
  // UploadThing / common image hosts
  if (url.includes('utfs.io') || url.includes('uploadthing')) return 'image'

  return 'unknown'
}

// ── Full-screen image lightbox ────────────────────────────────────────────────
function ImageLightbox({ url, onClose }) {
  const [zoom,     setZoom]     = useState(1)
  const [rotate,   setRotate]   = useState(0)
  const [pan,      setPan]      = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef(null)

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape')             onClose()
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 5))
      if (e.key === '-')                  setZoom(z => Math.max(z - 0.25, 0.25))
      if (e.key === 'r' || e.key === 'R') setRotate(r => (r + 90) % 360)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Prevent page scroll when lightbox open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function onWheel(e) {
    e.preventDefault()
    setZoom(z => Math.min(Math.max(z + (e.deltaY < 0 ? 0.15 : -0.15), 0.25), 5))
  }

  function onMouseDown(e) {
    if (e.button !== 0) return
    setDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  function onMouseMove(e) {
    if (!dragging || !dragStart.current) return
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
  }
  function onMouseUp() { setDragging(false) }
  function resetView() { setZoom(1); setRotate(0); setPan({ x: 0, y: 0 }) }

  const pct = Math.round(zoom * 100)

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/95 flex flex-col select-none"
      onWheel={onWheel}
      style={{ touchAction: 'none' }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Zoom out">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button onClick={resetView}
            className="min-w-[52px] px-2 py-1 rounded text-xs font-mono text-white/80 hover:text-white hover:bg-white/10 transition-colors" title="Reset">
            {pct}%
          </button>
          <button onClick={() => setZoom(z => Math.min(z + 0.25, 5))}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Zoom in">
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-white/20 mx-1" />
          <button onClick={() => setRotate(r => (r + 90) % 360)}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Rotate (R)">
            <RotateCw className="w-4 h-4" />
          </button>
          {[1, 2, 3].map(z => (
            <button key={z} onClick={() => { setZoom(z); setPan({ x: 0, y: 0 }) }}
              className={cn('hidden sm:block px-2 py-1 rounded text-xs font-medium transition-colors ml-1',
                zoom === z ? 'bg-white text-black' : 'text-white/60 hover:text-white hover:bg-white/10')}>
              {z}×
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <a href={url} download target="_blank" rel="noopener noreferrer"
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Download">
            <Download className="w-4 h-4" />
          </a>
          <button onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden flex items-center justify-center"
        style={{ cursor: dragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <img
          src={url} alt="Document" draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotate}deg)`,
            transition: dragging ? 'none' : 'transform 0.12s ease',
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
          }}
        />
      </div>

      <div className="shrink-0 text-center py-2 text-[11px] text-white/30">
        Scroll to zoom · Drag to pan · R to rotate · Esc to close
      </div>
    </div>,
    document.body,
  )
}

// ── Full-screen PDF viewer ─────────────────────────────────────────────────────
function PdfViewer({ url, onClose }) {
  // Prevent page scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-white/10 shrink-0">
        <span className="text-sm text-white/70 font-medium flex items-center gap-2">
          <FileText className="w-4 h-4" /> PDF Preview
        </span>
        <div className="flex items-center gap-1">
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Open in new tab">
            <ExternalLink className="w-4 h-4" />
          </a>
          <a href={url} download target="_blank" rel="noopener noreferrer"
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Download">
            <Download className="w-4 h-4" />
          </a>
          <button onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/*
        Use <embed> instead of <iframe> — more reliable for inline PDF rendering
        across Chrome, Firefox, and Edge. The browser's native PDF viewer handles
        zoom, page nav, and print natively inside the embed.
      */}
      <embed
        src={url}
        type="application/pdf"
        className="flex-1 w-full"
        style={{ minHeight: 0 }}
      />

      {/* Fallback for browsers that don't support embedded PDFs (e.g. mobile Safari) */}
      <noscript>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-white/70 text-sm">Your browser cannot display this PDF inline.</p>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium">
            Open PDF
          </a>
        </div>
      </noscript>
    </div>,
    document.body,
  )
}

// ── Main DocPreview component ─────────────────────────────────────────────────
/**
 * DocPreview — inline thumbnail that opens a fullscreen viewer on click.
 *
 * Props:
 *   url       string  — document URL (image or PDF)
 *   label     string  — optional section label
 *   className string
 *   compact   boolean — show only a small chip instead of a thumbnail card
 */
export default function DocPreview({ url, label, className, compact = false }) {
  const [viewer,  setViewer]  = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  if (!url) return null

  const type     = getFileType(url)
  const isImage  = type === 'image'
  const isPdf    = type === 'pdf'
  const filename = decodeURIComponent(url.split('/').pop().split('?')[0])

  // ── Compact mode: just a clickable chip ──────────────────────────────────
  if (compact) {
    return (
      <>
        <button type="button" onClick={() => setViewer(true)}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors',
            isPdf
              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
            className,
          )}>
          {isPdf ? <FileText className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          {isPdf ? 'View PDF' : 'View Image'}
        </button>

        {mounted && viewer && isImage && <ImageLightbox url={url} onClose={() => setViewer(false)} />}
        {mounted && viewer && isPdf   && <PdfViewer     url={url} onClose={() => setViewer(false)} />}
        {mounted && viewer && !isImage && !isPdf && (
          <_OpenInTab url={url} onDone={() => setViewer(false)} />
        )}
      </>
    )
  }

  // ── Full thumbnail card mode ─────────────────────────────────────────────
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <p className="text-xs font-medium text-gray-500">{label}</p>}

      {/* Thumbnail */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setViewer(true)}
        onKeyDown={e => e.key === 'Enter' && setViewer(true)}
        className="relative group cursor-zoom-in rounded-xl overflow-hidden border border-gray-200 bg-gray-50 hover:border-blue-300 transition-colors"
        style={{ minHeight: 100 }}
      >
        {isImage ? (
          <>
            <img src={url} alt={filename} className="w-full object-cover" style={{ maxHeight: 200 }} />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-2.5 shadow">
                <ZoomIn className="w-5 h-5 text-gray-800" />
              </div>
            </div>
          </>
        ) : isPdf ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-7 px-4">
            <div className="w-11 h-11 bg-red-50 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-red-500" />
            </div>
            <p className="text-xs font-medium text-gray-700 truncate max-w-[180px] text-center">{filename}</p>
            <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
              <Maximize2 className="w-3 h-3" /> Click to preview
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2.5 py-7 px-4">
            <div className="w-11 h-11 bg-gray-100 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-xs text-gray-500 truncate max-w-[180px] text-center">{filename}</p>
            <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Open file
            </a>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setViewer(true)}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
          <Maximize2 className="w-3 h-3" />
          {isImage ? 'View full size' : isPdf ? 'Open PDF viewer' : 'Preview'}
        </button>
        <a href={url} download target="_blank" rel="noopener noreferrer"
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
          <Download className="w-3 h-3" /> Download
        </a>
      </div>

      {/* Viewers */}
      {mounted && viewer && isImage  && <ImageLightbox url={url} onClose={() => setViewer(false)} />}
      {mounted && viewer && isPdf    && <PdfViewer     url={url} onClose={() => setViewer(false)} />}
      {mounted && viewer && !isImage && !isPdf && (
        <_OpenInTab url={url} onDone={() => setViewer(false)} />
      )}
    </div>
  )
}

// Helper: open unknown file type in new tab without breaking render
function _OpenInTab({ url, onDone }) {
  useEffect(() => {
    window.open(url, '_blank', 'noopener,noreferrer')
    onDone()
  }, [url, onDone])
  return null
}
