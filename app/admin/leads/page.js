'use client'

import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, Plus, Wallet, Trophy, XCircle, Users, X } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import StatsCard from '@/components/ui/StatsCard'
import SearchInput from '@/components/ui/SearchInput'
import FilterSelect from '@/components/ui/FilterSelect'
import DatePicker from '@/components/ui/DatePicker'
import Pagination from '@/components/ui/Pagination'
import LeadsTable from '@/components/admin/leads/LeadsTable'
import LeadModal from '@/components/admin/leads/LeadModal'
import { Can } from '@/components/auth/Can'
import { formatCurrency } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'NEW',           label: 'New' },
  { value: 'CONTACTED',     label: 'Contacted' },
  { value: 'PROPOSAL_SENT', label: 'Proposal sent' },
  { value: 'NEGOTIATION',   label: 'Negotiation' },
  { value: 'WON',           label: 'Won' },
  { value: 'LOST',          label: 'Lost' },
]

const PRIORITY_OPTIONS = [
  { value: 'LOW',    label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH',   label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
]

export default function LeadsPage() {
  const [leads,           setLeads]           = useState([])
  const [meta,            setMeta]            = useState({ page: 1, pages: 1, total: 0, limit: 20 })
  const [stats,           setStats]           = useState(null)
  const [loading,         setLoading]         = useState(true)
  const [search,          setSearch]          = useState('')
  const [status,          setStatus]          = useState(null)
  const [priority,        setPriority]        = useState(null)
  const [platform,        setPlatform]        = useState(null)
  const [platformOptions, setPlatformOptions] = useState([])
  const [dateFrom,        setDateFrom]        = useState('')
  const [dateTo,          setDateTo]          = useState('')
  const [page,            setPage]            = useState(1)
  const [modalOpen,       setModalOpen]       = useState(false)
  const [editingLead,     setEditingLead]     = useState(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search)   params.set('search',   search)
      if (status)   params.set('status',   status)
      if (priority) params.set('priority', priority)
      if (platform) params.set('platform', platform)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo)   params.set('dateTo',   dateTo)

      const res  = await fetch(`/api/leads?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setLeads(data.data ?? [])
      setMeta(data.meta ?? { page: 1, pages: 1, total: 0, limit: 20 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [page, search, status, priority, platform, dateFrom, dateTo])

  const fetchStats = useCallback(async () => {
    try {
      const res  = await fetch('/api/leads/stats')
      const json = await res.json()
      if (res.ok) {
        const d = json.data ?? {}
        setStats({
          total:         d.total         ?? 0,
          newLeads:      d.newCount      ?? 0,
          won:           d.won           ?? 0,
          lost:          d.lost          ?? 0,
          pipelineValue: d.pipelineValue ?? 0,
        })
      }
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(j => {
      const platforms = j.data?.leadPlatforms ?? []
      setPlatformOptions(platforms.map(p => ({ value: p, label: p })))
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])
  useEffect(() => { fetchStats() }, [fetchStats])

  const handleSearch   = (val) => { setSearch(val);   setPage(1) }
  const handleStatus   = (val) => { setStatus(val);   setPage(1) }
  const handlePriority = (val) => { setPriority(val); setPage(1) }
  const handlePlatform = (val) => { setPlatform(val); setPage(1) }

  const handleStatusChange = (leadId, newStatus) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l))
    fetchStats()
  }

  const handleEdit = (lead) => {
    setEditingLead(lead)
    setModalOpen(true)
  }

  const handleModalClose = () => {
    setModalOpen(false)
    setEditingLead(null)
  }

  const handleModalSuccess = () => {
    fetchLeads()
    fetchStats()
  }

  const hasFilters = !!(search || status || priority || platform || dateFrom || dateTo)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        actions={
          <Can perm="sales.leads.create">
            <Button onClick={() => { setEditingLead(null); setModalOpen(true) }}>
              <Plus /> New lead
            </Button>
          </Can>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatsCard
          title="Total leads"
          value={stats?.total ?? '—'}
          icon={Users}
        />
        <StatsCard
          title="New"
          value={stats?.newLeads ?? '—'}
          icon={TrendingUp}
          color="blue"
        />
        <StatsCard
          title="Won"
          value={stats?.won ?? '—'}
          icon={Trophy}
          color="green"
        />
        <StatsCard
          title="Lost"
          value={stats?.lost ?? '—'}
          icon={XCircle}
          color="red"
          positive={false}
        />
        <StatsCard
          title="Pipeline value"
          value={stats ? (typeof stats.pipelineValue === 'string' ? stats.pipelineValue : formatCurrency(stats.pipelineValue)) : '—'}
          icon={Wallet}
        />
      </div>

      <Card className="overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
          <SearchInput
            value={search}
            onChange={handleSearch}
            placeholder="Search…"
            className="w-full sm:w-64"
          />
          <FilterSelect
            value={status}
            onChange={handleStatus}
            options={STATUS_OPTIONS}
            placeholder="All statuses"
            className="w-36"
          />
          <FilterSelect
            value={priority}
            onChange={handlePriority}
            options={PRIORITY_OPTIONS}
            placeholder="All priorities"
            className="w-36"
          />
          <FilterSelect
            value={platform}
            onChange={handlePlatform}
            options={platformOptions}
            placeholder="All platforms"
            className="w-36"
          />
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <DatePicker value={dateFrom || null} onChange={v => { setDateFrom(v ?? ''); setPage(1) }} placeholder="From" size="sm" className="w-36" />
            <span className="text-muted-foreground">–</span>
            <DatePicker value={dateTo || null} onChange={v => { setDateTo(v ?? ''); setPage(1) }} placeholder="To" size="sm" className="w-36" />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearch(''); setStatus(null); setPriority(null); setPlatform(null); setDateFrom(''); setDateTo(''); setPage(1) }}
              >
                <X /> Clear
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-gray-100" />
            ))}
          </div>
        ) : (
          <LeadsTable
            leads={leads}
            onEdit={handleEdit}
            onRefresh={() => { fetchLeads(); fetchStats() }}
            onStatusChange={handleStatusChange}
          />
        )}

        {/* Pagination */}
        {!loading && meta.pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination
              page={meta.page}
              pages={meta.pages}
              total={meta.total}
              limit={meta.limit}
              onPageChange={setPage}
            />
          </div>
        )}
      </Card>

      {/* Modal */}
      <LeadModal
        open={modalOpen}
        onClose={handleModalClose}
        lead={editingLead}
        onSuccess={handleModalSuccess}
      />
    </div>
  )
}
