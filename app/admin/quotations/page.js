'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, X, Loader2, Copy, Trash2, Eye, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Pagination from '@/components/ui/Pagination'
import { NativeSelect, inputClass } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { Can, usePermission } from '@/components/auth/Can'
import { CURRENCIES } from '@/lib/currencies'
import { isVatQuotation } from '@/lib/quotation'
import { cn } from '@/lib/utils'

const STATUS_STYLES = {
  DRAFT:    { variant: 'default', label: 'Draft' },
  SENT:     { variant: 'primary', label: 'Sent' },
  ACCEPTED: { variant: 'success', label: 'Accepted' },
  REJECTED: { variant: 'danger',  label: 'Rejected' },
}

const curSymbol = (code) => CURRENCIES.find(c => c.code === (code || 'BDT'))?.symbol ?? code
const fmt     = (n, cur) => `${curSymbol(cur)} ${(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function QuotationsPage() {
  const router = useRouter()
  const [quotations, setQuotations] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [search,     setSearch]     = useState('')
  const [status,     setStatus]     = useState('')
  const [page,       setPage]       = useState(1)
  const [total,      setTotal]      = useState(0)
  const [deleting,   setDeleting]   = useState(null)
  const { can } = usePermission()
  const limit = 20

  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const p = new URLSearchParams({ page, limit })
      if (search) p.set('search', search)
      if (status) p.set('status', status)
      const res  = await fetch(`/api/quotations?${p}`)
      const json = await res.json().catch(() => ({}))
      if (id !== reqId.current) return // a newer request superseded this one
      if (!res.ok) throw new Error(json.error || 'Failed to load quotations')
      setQuotations(json.data ?? [])
      setTotal(json.meta?.total ?? 0)
    } catch (err) { if (id === reqId.current) toast.error(err.message || 'Failed to load quotations') }
    finally { if (id === reqId.current) setLoading(false) }
  }, [page, search, status])

  useEffect(() => { load() }, [load])

  // Debounce the search box; reset to page 1 in the same update as the filter
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) { setSearch(searchInput); setPage(1) }
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, search])

  async function duplicate(id) {
    try {
      const res  = await fetch(`/api/quotations/${id}/duplicate`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Quotation duplicated')
      router.push(`/admin/quotations/${json.data.id}`)
    } catch (err) { toast.error(err.message) }
  }

  async function del(id) {
    if (!confirm('Delete this quotation? This can\'t be undone.')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/quotations/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Deleted')
      // Deleting the last row on a later page: step back instead of showing an empty page
      if (quotations.length === 1 && page > 1) setPage(p => p - 1)
      else load()
    } catch (err) { toast.error(err.message) }
    finally { setDeleting(null) }
  }

  const pages = Math.ceil(total / limit)
  const filtered = !!(search || status)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description={`${total} quotation${total !== 1 ? 's' : ''}`}
        actions={
          <Can perm="sales.quotations.create">
            <Button href="/admin/quotations/new"><Plus /> New quotation</Button>
          </Can>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Search…"
            className={cn(inputClass, 'pl-9 pr-8')} />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }} aria-label="Clear search"
              className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <NativeSelect value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="w-auto min-w-[140px]">
          <option value="">All statuses</option>
          {Object.entries(STATUS_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </NativeSelect>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingSpinner className="py-16" />
        ) : quotations.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filtered ? 'No results' : total > 0 ? 'No quotations on this page' : 'No quotations yet'}
            action={
              page > 1 ? (
                <Button variant="outline" size="sm" onClick={() => setPage(1)}>Back to first page</Button>
              ) : !filtered && total === 0 && can('sales.quotations.create') ? (
                <Button variant="outline" size="sm" href="/admin/quotations/new"><Plus /> New quotation</Button>
              ) : null
            }
          />
        ) : (
          <>
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  {['Quotation', 'Recipient', 'Source', 'Total', 'Issue date', 'Valid until', 'Status', ''].map(h => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotations.map(q => {
                  const s = STATUS_STYLES[q.status] ?? STATUS_STYLES.DRAFT
                  return (
                    <TableRow key={q.id}>
                      <TableCell>
                        <Link href={`/admin/quotations/${q.id}`} className="font-mono text-[13px] font-medium text-gray-900 underline-offset-4 hover:underline">
                          {q.quotationNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-gray-900">{q.recipientName || '—'}</p>
                        {q.recipientCompany && <p className="text-xs text-muted-foreground">{q.recipientCompany}</p>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={q.sourceType === 'LEAD' ? 'purple' : 'teal'}>
                          {q.sourceType === 'LEAD' ? 'Lead' : 'Client'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="whitespace-nowrap font-medium tabular-nums text-gray-900">{fmt(q.total, q.currency)}</p>
                        {isVatQuotation(q) && (
                          <p className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {Number(q.vatAmount) > 0
                              ? `incl. VAT ${fmt(q.vatAmount, q.currency)}`
                              : q.vatTreatment === 'ZERO_RATED' ? 'Zero-rated' : q.vatTreatment === 'EXEMPT' ? 'VAT exempt' : 'No VAT charged'}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(q.issueDate)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(q.validUntil)}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant} dot>{s.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          <Button variant="ghost" size="icon-sm" href={`/admin/quotations/${q.id}`} title="View" aria-label="View"
                            className="text-gray-500">
                            <Eye />
                          </Button>
                          {can('sales.quotations.create') && (
                            <Button variant="ghost" size="icon-sm" onClick={() => duplicate(q.id)} title="Duplicate" aria-label="Duplicate"
                              className="text-gray-500">
                              <Copy />
                            </Button>
                          )}
                          {can('sales.quotations.delete') && (
                            <Button variant="ghost" size="icon-sm" onClick={() => del(q.id)} disabled={deleting === q.id}
                              title="Delete" aria-label="Delete"
                              className="text-gray-500 hover:bg-red-50 hover:text-red-600">
                              {deleting === q.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {pages > 1 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <Pagination page={page} pages={pages} total={total} limit={limit} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
