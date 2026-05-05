'use client'

import { useState, useEffect } from 'react'
import { Files, Search, Download, ExternalLink, FileText, Image, File, ChevronLeft, ChevronRight } from 'lucide-react'

const CATEGORIES = [
  { value: 'ALL',       label: 'All' },
  { value: 'CONTRACT',  label: 'Contract' },
  { value: 'PROPOSAL',  label: 'Proposal' },
  { value: 'INVOICE',   label: 'Invoice' },
  { value: 'REPORT',    label: 'Report' },
  { value: 'LEGAL',     label: 'Legal' },
  { value: 'OTHER',     label: 'Other' },
]

function FileIcon({ mime }) {
  if (!mime) return <File className="w-5 h-5 text-gray-400" />
  if (mime.startsWith('image/'))      return <Image className="w-5 h-5 text-purple-400" />
  if (mime === 'application/pdf')     return <FileText className="w-5 h-5 text-red-400" />
  return <File className="w-5 h-5 text-blue-400" />
}

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ClientDocumentsPage() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [category, setCategory]   = useState('ALL')
  const [search, setSearch]       = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage]           = useState(1)
  const [total, setTotal]         = useState(0)
  const [pages, setPages]         = useState(1)
  const limit                     = 20

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit })
    if (category !== 'ALL') params.set('category', category)
    if (search) params.set('search', search)
    fetch(`/api/client/documents?${params}`)
      .then(r => r.json())
      .then(d => {
        setDocuments(d.documents ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
      })
      .catch(() => setError('Failed to load documents'))
      .finally(() => setLoading(false))
  }, [category, search, page])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-sm text-gray-500 mt-0.5">{total} document{total !== 1 ? 's' : ''} shared with you</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button key={cat.value} onClick={() => { setCategory(cat.value); setPage(1) }}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                category === cat.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
              }`}>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Document list */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-50">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                <div className="w-9 h-9 bg-gray-100 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-48" />
                  <div className="h-3 bg-gray-100 rounded w-32" />
                </div>
                <div className="h-5 bg-gray-100 rounded-full w-16" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-12 text-center text-red-500 text-sm">{error}</div>
        ) : documents.length === 0 ? (
          <div className="p-16 text-center">
            <Files className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No documents found</p>
            <p className="text-gray-400 text-sm mt-1">Documents shared with you will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {documents.map(doc => (
              <div key={doc.id} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50/60 transition-colors group">
                <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100 shrink-0">
                  <FileIcon mime={doc.mimeType} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {doc.projectId?.name && (
                      <span className="text-xs text-gray-400">{doc.projectId.name}</span>
                    )}
                    {doc.fileSize && (
                      <span className="text-xs text-gray-400">{formatBytes(doc.fileSize)}</span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {doc.category && doc.category !== 'OTHER' && (
                  <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    {doc.category}
                  </span>
                )}
                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-colors shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {page} of {pages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
