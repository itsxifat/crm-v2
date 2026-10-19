'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, Loader2, Search, X, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'

const VAT_LABEL = {
  REGISTERED: 'VAT registered',
  TURNOVER: 'Turnover tax',
  UNREGISTERED: 'Not VAT registered',
  FOREIGN: 'Foreign',
}

const PAYEE_LABEL = { COMPANY: 'Company', INDIVIDUAL: 'Individual', NON_RESIDENT: 'Non-resident' }

/** Vendor API row → the fields the purchase form uses. */
export function pickVendorFields(v) {
  if (!v) return null
  return {
    id: v.id ?? v._id ?? null,
    company: v.company ?? '',
    bin: v.bin ?? null,
    vatRegistrationType: v.vatRegistrationType ?? null,
    payeeType: v.payeeType ?? 'COMPANY',
    hasPsr: Boolean(v.hasPsr),
    defaultTdsSection: v.defaultTdsSection ?? null,
    defaultVatServiceCode: v.defaultVatServiceCode ?? null,
  }
}

/**
 * Searchable vendor picker (GET /api/vendors?search=).
 *
 * Props:
 *   value        selected vendor (pickVendorFields shape) or null
 *   onChange     (vendor | null) => void
 *   onOneOff     (name) => void — "use as a one-off supplier" (optional)
 *   disabled, placeholder
 */
export default function VendorPicker({ value, onChange, onOneOff, disabled = false, placeholder = 'Search vendors…' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const boxRef = useRef(null)
  const reqId = useRef(0)

  useEffect(() => {
    if (!open) return undefined
    const id = ++reqId.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '12' })
        if (q.trim()) params.set('search', q.trim())
        const res = await fetch(`/api/vendors?${params}`)
        const json = await res.json().catch(() => ({}))
        if (id !== reqId.current) return
        if (!res.ok) {
          setResults([])
          setError(res.status === 403 ? 'You cannot browse vendors — type the supplier name as a one-off instead.' : (json.error || 'Could not load vendors'))
        } else {
          setError(null)
          setResults((json.data ?? []).map(pickVendorFields))
        }
      } catch {
        if (id === reqId.current) { setResults([]); setError('Could not load vendors') }
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q, open])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(v) {
    onChange?.(v)
    setOpen(false)
    setQ('')
  }

  if (value) {
    return (
      <div className="flex items-start justify-between gap-2 w-full border border-gray-200 rounded-lg px-3 py-2 bg-white">
        <div className="flex items-start gap-2 min-w-0">
          <Building2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{value.company}</p>
            <p className="text-xs text-gray-500 truncate">
              {[value.bin ? `BIN ${value.bin}` : 'No BIN on file', VAT_LABEL[value.vatRegistrationType] ?? null, PAYEE_LABEL[value.payeeType] ?? null, value.hasPsr ? 'PSR shown' : 'No PSR'].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {!disabled && (
          <button type="button" onClick={() => onChange?.(null)} className="p-1 text-gray-400 hover:text-gray-600 shrink-0" aria-label="Clear vendor">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between gap-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 bg-white hover:border-gray-300 disabled:bg-gray-50"
      >
        <span className="flex items-center gap-2"><Search className="w-4 h-4" /> {placeholder}</span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-50">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Vendor name or BIN…"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {error && <p className="px-4 py-3 text-xs text-amber-700">{error}</p>}
            {!error && !loading && results.length === 0 && (
              <p className="px-4 py-5 text-center text-sm text-gray-400">{q ? 'No vendors match' : 'No vendors yet'}</p>
            )}
            {results.map(v => (
              <button
                type="button"
                key={v.id}
                onClick={() => pick(v)}
                className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-gray-50 text-left"
              >
                <Building2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{v.company}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {[v.bin ? `BIN ${v.bin}` : null, VAT_LABEL[v.vatRegistrationType] ?? null].filter(Boolean).join(' · ') || 'No tax details'}
                  </p>
                </div>
              </button>
            ))}
            {onOneOff && q.trim() && (
              <button
                type="button"
                onClick={() => { onOneOff(q.trim()); setOpen(false); setQ('') }}
                className={cn('w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50', results.length && 'border-t border-gray-50')}
              >
                <UserPlus className="w-4 h-4 text-gray-400" />
                Use “{q.trim()}” as a one-off supplier
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
