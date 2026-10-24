'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, Clock, ChevronRight } from 'lucide-react'
import { STATUS_META } from '@/lib/ventures'
import ProjectStatusBadge from '@/components/portals/ProjectStatusBadge'
import { CURRENCIES } from '@/lib/currencies'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import SearchInput from '@/components/ui/SearchInput'
import EmptyState from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { codeIncludes } from '@/lib/searchMatch'

// Each project's amounts are shown in that project's own currency.
const fmtTk = (n, cur = 'BDT') => `${CURRENCIES.find(c => c.code === cur)?.symbol ?? cur} ${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function ClientProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch]     = useState('')

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/client/projects')
        if (!res.ok) throw new Error('Failed to load projects')
        const data = await res.json()
        setProjects(data.projects || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchProjects()
  }, [])

  // Build the status filter chips from the statuses actually present, with counts.
  const statusChips = useMemo(() => {
    const counts = {}
    for (const p of projects) counts[p.status] = (counts[p.status] ?? 0) + 1
    const chips = [{ key: 'ALL', label: 'All', count: projects.length }]
    for (const key of Object.keys(counts)) {
      chips.push({ key, label: STATUS_META[key]?.label ?? key, count: counts[key] })
    }
    return chips
  }, [projects])

  const filtered = projects.filter((p) => {
    const matchStatus = statusFilter === 'ALL' || p.status === statusFilter
    // Project codes match with separators ignored (ENTP-2610A01 = ENTP2610A01).
    const matchSearch = !search.trim() ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      codeIncludes(p.projectCode, search)
    return matchStatus && matchSearch
  })

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded-md bg-gray-100" />
        <Card className="divide-y divide-gray-100">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
              <div className="h-4 w-20 shrink-0 rounded-md bg-gray-100" />
              <div className="h-4 w-1/3 rounded-md bg-gray-100" />
              <div className="ml-auto h-5 w-20 shrink-0 rounded-full bg-gray-100" />
            </div>
          ))}
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description={`${projects.length} project${projects.length !== 1 ? 's' : ''}`}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          debounceMs={0}
          placeholder="Search…"
          className="w-full sm:w-64"
        />
        <Tabs
          value={statusFilter}
          onChange={setStatusFilter}
          tabs={statusChips.map(({ key, label, count }) => ({ value: key, label, count }))}
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          statusFilter !== 'ALL' || search
            ? <EmptyState icon={FolderOpen} title="No results" description="Try changing the filters." />
            : <EmptyState icon={FolderOpen} title="No projects yet" />
        ) : (
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Due / renews</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const isMonthly = p.projectType === 'MONTHLY'
                const due = isMonthly ? p.currentPeriodEnd : p.deadline
                const isOverdue = due && new Date(due) < new Date()
                  && !['DELIVERED', 'CANCELLED', 'APPROVED', 'RENEWED'].includes(p.status)
                return (
                  <TableRow
                    key={p.id}
                    onClick={() => router.push(`/client/projects/${p.id}`)}
                    className="group cursor-pointer"
                  >
                    <TableCell className="whitespace-nowrap font-mono text-xs text-gray-600">
                      {p.projectCode ?? '—'}
                    </TableCell>
                    <TableCell className="min-w-44">
                      <p className="max-w-[220px] truncate font-medium text-gray-900">{p.name}</p>
                      {(p.category || p.subcategory) && (
                        <p className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">
                          {p.category}{p.subcategory ? ` › ${p.subcategory}` : ''}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-gray-600">{isMonthly ? 'Monthly' : 'Fixed'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-900">{fmtTk(p.netValue, p.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-600">{fmtTk(p.paidAmount, p.currency)}</TableCell>
                    <TableCell className={cn('whitespace-nowrap text-right tabular-nums', p.dueAmount > 0 ? 'text-amber-600' : 'text-gray-400')}>
                      {fmtTk(p.dueAmount, p.currency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {due ? (
                        <span className={cn('inline-flex items-center gap-1.5 text-xs', isOverdue ? 'text-red-600' : 'text-gray-600')}>
                          <Clock className="size-3.5 text-current opacity-70" />
                          {isOverdue ? 'Overdue · ' : ''}{fmtDate(due)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <ProjectStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="size-4 text-gray-300 transition-colors group-hover:text-gray-600" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
