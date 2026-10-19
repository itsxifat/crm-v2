'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, Loader2, Search, X, UserPlus } from 'lucide-react'
import Button from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Input'
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
          setError(res.status === 403 ? "You can't browse vendors — type the name as a one-off." : (json.error || "Couldn't load vendors"))
        } else {
          setError(null)
          setResults((json.data ?? []).map(pickVendorFields))
        }
      } catch {
        if (id === reqId.current) { setResults([]); setError("Couldn't load vendors") }
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
      <div className="flex w-full items-start justify-between gap-2 rounded-lg border border-input bg-white px-3 py-2 shadow-xs">
        <div className="flex min-w-0 items-start gap-2">
          <Building2 className="mt-0.5 size-4 shrink-0 text-gray-400" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">{value.company}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[value.bin ? `BIN ${value.bin}` : 'No BIN on file', VAT_LABEL[value.vatRegistrationType] ?? null, PAYEE_LABEL[value.payeeType] ?? null, value.hasPsr ? 'PSR shown' : 'No PSR'].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {!disabled && (
          <Button variant="ghost" size="icon-xs" onClick={() => onChange?.(null)} className="-mr-1 text-gray-400" aria-label="Clear vendor">
            <X />
          </Button>
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
        className={cn(inputClass, 'items-center justify-between gap-2 text-left text-gray-500 hover:bg-gray-50/60')}
      >
        <span className="flex min-w-0 items-center gap-2 truncate"><Search className="size-4 shrink-0 text-gray-400" /> {placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3">
            <Search className="size-4 shrink-0 text-gray-400" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Name or BIN…"
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
            {loading && <Loader2 className="size-4 animate-spin text-gray-400" />}
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {error && <p className="px-3 py-2.5 text-xs text-amber-700">{error}</p>}
            {!error && !loading && results.length === 0 && (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">{q ? 'No results' : 'No vendors yet'}</p>
            )}
            {results.map(v => (
              <button
                type="button"
                key={v.id}
                onClick={() => pick(v)}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-gray-100"
              >
                <Building2 className="mt-0.5 size-4 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{v.company}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[v.bin ? `BIN ${v.bin}` : null, VAT_LABEL[v.vatRegistrationType] ?? null].filter(Boolean).join(' · ') || 'No tax details'}
                  </p>
                </div>
              </button>
            ))}
            {onOneOff && q.trim() && (
              <button
                type="button"
                onClick={() => { onOneOff(q.trim()); setOpen(false); setQ('') }}
                className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-100', results.length && 'mt-1 border-t border-gray-100')}
              >
                <UserPlus className="size-4 shrink-0 text-gray-400" />
                Use “{q.trim()}” as a one-off supplier
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
