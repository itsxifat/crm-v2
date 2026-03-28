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
 */
export default function FileUpload({ value, onUploaded, label = 'Receipt / Invoice', accept = 'image/*,application/pdf' }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      onUploaded(json.url)
      toast.success('File uploaded')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading(false)
    }
  }

  const filename = value ? value.split('/').pop() : null
  const isPdf    = filename?.endsWith('.pdf')

  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}

      {value ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50">
          {isPdf
            ? <FileText className="w-4 h-4 text-red-500 shrink-0" />
            : <Image src={value} alt="receipt" width={32} height={32} className="w-8 h-8 object-cover rounded" />
          }
          <a href={value} target="_blank" rel="noopener noreferrer"
            className="flex-1 text-xs text-blue-600 hover:underline truncate">
            {filename}
          </a>
          <button type="button" onClick={() => onUploaded('')}
            className="p-0.5 text-gray-400 hover:text-red-500 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
          {uploading
            ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            : <Upload className="w-4 h-4 text-gray-400" />
          }
          <span className="text-xs text-gray-500">
            {uploading ? 'Uploading…' : 'Click to upload (JPG, PNG, PDF — max 5 MB)'}
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
