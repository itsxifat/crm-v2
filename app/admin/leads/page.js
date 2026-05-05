'use client'

import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, Plus, DollarSign, Trophy, XCircle, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import StatsCard from '@/components/ui/StatsCard'
import SearchInput from '@/components/ui/SearchInput'
import FilterSelect from '@/components/ui/FilterSelect'
import DatePicker from '@/components/ui/DatePicker'
import Pagination from '@/components/ui/Pagination'
import LeadsTable from '@/components/admin/leads/LeadsTable'
import LeadModal from '@/components/admin/leads/LeadModal'
import { formatCurrency } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'NEW',           label: 'New' },
  { value: 'CONTACTED',     label: 'Contacted' },
  { value: 'PROPOSAL_SENT', label: 'Proposal Sent' },
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage and track your sales pipeline</p>
        </div>
        <button
          onClick={() => { setEditingLead(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Lead
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsCard
          title="Total Leads"
          value={stats?.total ?? '—'}
          icon={Users}
          color="blue"
        />
        <StatsCard
          title="New Leads"
          value={stats?.newLeads ?? '—'}
          icon={TrendingUp}
          color="indigo"
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
          title="Pipeline Value"
          value={stats ? formatCurrency(stats.pipelineValue) : '—'}
          icon={DollarSign}
          color="emerald"
        />
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={handleSearch}
            placeholder="Search name, company, email..."
            className="flex-1 min-w-[200px] max-w-sm"
          />
          <FilterSelect
            value={status}
            onChange={handleStatus}
            options={STATUS_OPTIONS}
            placeholder="All Statuses"
            className="w-36"
          />
          <FilterSelect
            value={priority}
            onChange={handlePriority}
            options={PRIORITY_OPTIONS}
            placeholder="All Priorities"
            className="w-36"
          />
          <FilterSelect
            value={platform}
            onChange={handlePlatform}
            options={platformOptions}
            placeholder="All Platforms"
            className="w-36"
          />
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500 font-medium">From</span>
            <DatePicker value={dateFrom || null} onChange={v => { setDateFrom(v ?? ''); setPage(1) }} placeholder="Start date" size="sm" className="w-36" />
            <span className="text-xs text-gray-500 font-medium">To</span>
            <DatePicker value={dateTo || null} onChange={v => { setDateTo(v ?? ''); setPage(1) }} placeholder="End date" size="sm" className="w-36" />
            {(search || status || priority || platform || dateFrom || dateTo) && (
              <button
                onClick={() => { setSearch(''); setStatus(null); setPriority(null); setPlatform(null); setDateFrom(''); setDateTo(''); setPage(1) }}
                className="px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8">
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
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
          <div className="px-4 py-3 border-t border-gray-100">
            <Pagination
              page={meta.page}
              pages={meta.pages}
              total={meta.total}
              limit={meta.limit}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

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
