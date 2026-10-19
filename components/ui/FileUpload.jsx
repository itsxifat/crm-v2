'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Upload, X, FileText, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * FileUpload — uploads a file to /api/upload and returns the URL via onUploaded(url)
 * Props:
 *   value       — current URL (controlled)
 *   onUploaded  — callback(url) when upload succeeds
 *   label       — optional label text
 *   accept      — input accept string (default: images + PDF)
 *   bucket      — optional storage bucket: 'receipts' (default) | 'assets' | 'tax'
 */
export default function FileUpload({ value, onUploaded, label = 'Receipt / Invoice', accept = 'image/*,application/pdf', bucket }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (bucket) fd.append('bucket', bucket)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      onUploaded(json.url)
      toast.success('File uploaded')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
      // Reset so picking the same file again (e.g. retry after a failure) fires onChange.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const filename = value ? value.split('/').pop() : null
  const isPdf    = filename?.endsWith('.pdf')

  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-900">{label}</label>}

      {value ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 shadow-xs">
          {isPdf
            ? <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-gray-100"><FileText className="size-4 text-gray-600" /></span>
            : <Image src={value} alt="receipt" width={32} height={32} className="size-8 object-cover rounded-md" />
          }
          <a href={value} target="_blank" rel="noopener noreferrer"
            className="flex-1 truncate text-[13px] font-medium text-gray-900 hover:underline">
            {filename}
          </a>
          <button type="button" onClick={() => onUploaded('')}
            className="inline-flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900" aria-label="Remove file">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2.5 transition-colors hover:border-gray-400 hover:bg-gray-50">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white shadow-xs">
            {uploading
              ? <Loader2 className="size-4 text-gray-500 animate-spin" />
              : <Upload className="size-4 text-gray-500" />
            }
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-gray-900">{uploading ? 'Uploading…' : 'Upload file'}</span>
            <span className="block text-xs text-muted-foreground">JPG, PNG or PDF · up to 5 MB</span>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={e => handleFile(e.target.files?.[0])}
          />
        </div>
      )}
    </div>
  )
}
