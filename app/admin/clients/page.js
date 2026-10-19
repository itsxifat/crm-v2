'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Wallet, TrendingUp, FolderOpen,
  Plus, Pencil, Trash2, Eye, RotateCcw,
  Phone, Globe,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import ClientModal from '@/components/admin/clients/ClientModal'
import { Can, usePermission } from '@/components/auth/Can'
import TkAmt from '@/components/ui/TkAmt'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import StatsCard from '@/components/ui/StatsCard'
import EmptyState from '@/components/ui/EmptyState'
import ActionMenu from '@/components/ui/ActionMenu'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) => n ? `৳ ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const KYC_VARIANT = { NOT_SUBMITTED: 'default', PENDING: 'warning', VERIFIED: 'success', REJECTED: 'danger' }
const KYC_LABEL   = { NOT_SUBMITTED: 'No KYC', PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Rejected' }

// ─── Row Menu ─────────────────────────────────────────────────────────────────

function RowMenu({ client, onEdit, onDeactivate, onReactivate }) {
  const isActive = client.isActive !== false && client.userId?.isActive !== false
  // PATCH /api/clients/[id]/status is SUPER_ADMIN-only
  const { role } = usePermission()
  const canToggleStatus = role === 'SUPER_ADMIN'

  return (
    <ActionMenu
      items={[
        { label: 'View', icon: Eye, href: `/admin/clients/${client.id}` },
        { label: 'Edit', icon: Pencil, onClick: () => onEdit(client) },
        canToggleStatus && (isActive
          ? { label: 'Deactivate', icon: Trash2, danger: true, onClick: () => onDeactivate(client) }
          : { label: 'Reactivate', icon: RotateCcw, onClick: () => onReactivate(client) }),
      ]}
    />
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [clients,       setClients]       = useState([])
  const [stats,         setStats]         = useState(null)
  const [meta,          setMeta]          = useState({ page: 1, pages: 1, total: 0 })
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [typeFilter,    setTypeFilter]    = useState('')   // '' | INDIVIDUAL | COMPANY
  const [page,          setPage]          = useState(1)
  const [modalOpen,     setModalOpen]     = useState(false)
  const [editingClient, setEditingClient] = useState(null)

  const fetchClients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search) params.set('search', search)
      if (typeFilter) params.set('clientType', typeFilter)
      const res  = await fetch(`/api/clients?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setClients(json.data ?? [])
      setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
      if (json.stats) setStats(json.stats)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load clients')
    } finally {
      setLoading(false)
    }
  }, [page, search, typeFilter])

  useEffect(() => { fetchClients() }, [fetchClients])

  function handleSaved(client, _, emailSent, linkedToExisting) {
    if (!editingClient) {
      if (emailSent) {
        toast.success('Client created. Activation link emailed.', { duration: 6000 })
      } else if (linkedToExisting) {
        toast.success('Client created and linked to existing account.', { duration: 6000 })
      } else {
        toast.success('Client created. Activation email failed (check SMTP).', { duration: 6000 })
      }
    } else {
      toast.success('Client updated')
    }
    setEditingClient(null)
    fetchClients()
  }

  function openEdit(client) { setEditingClient(client); setModalOpen(true) }

  async function setClientActive(client, isActive) {
    const verb = isActive ? 'Reactivate' : 'Deactivate'
    if (!confirm(`${verb} ${client.userId?.name}? ${isActive ? 'They will regain portal access.' : 'They will lose portal access.'}`)) return
    try {
      const res = await fetch(`/api/clients/${client.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success(isActive ? 'Client reactivated' : 'Client deactivated')
      fetchClients()
    } catch (err) {
      toast.error(err.message ?? `Failed to ${verb.toLowerCase()}`)
    }
  }

  const handleDeactivate = (client) => setClientActive(client, false)
  const handleReactivate = (client) => setClientActive(client, true)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        actions={
          <Can perm="sales.customers.create">
            <Button onClick={() => { setEditingClient(null); setModalOpen(true) }}>
              <Plus /> New client
            </Button>
          </Can>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Total clients"   value={stats.totalClients}            icon={Users}      />
          <StatsCard title="Total revenue"   value={fmt(stats.totalRevenue)}       icon={Wallet}     />
          <StatsCard title="Outstanding"     value={fmt(stats.outstandingBalance)} icon={TrendingUp} color="yellow" />
          <StatsCard title="Active projects" value={stats.activeProjectCount ?? 0} icon={FolderOpen} />
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1) }}
            placeholder="Search…"
            className="w-full sm:w-64"
          />
          <Tabs
            size="sm"
            value={typeFilter}
            onChange={(v) => { setTypeFilter(v); setPage(1) }}
            tabs={[
              { value: '',           label: 'All' },
              { value: 'INDIVIDUAL', label: 'Individuals' },
              { value: 'COMPANY',    label: 'Companies' },
            ]}
          />
          <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">{meta.total} client{meta.total !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <PageLoader />
        ) : clients.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? 'No results' : 'No clients yet'}
            description={search ? 'Try a different search.' : undefined}
          />
        ) : (
          <Table className="min-w-[1050px]">
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-center">Projects</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => {
                const isActive = client.isActive !== false && client.userId?.isActive !== false
                const kycStatus = client.kyc?.status ?? 'NOT_SUBMITTED'
                return (
                  <TableRow key={client.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={client.userId?.name} src={client.userId?.avatar} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Link href={`/admin/clients/${client.id}`}
                              className="font-medium text-gray-900 hover:underline underline-offset-4">
                              {client.userId?.name ?? '—'}
                            </Link>
                            <Badge variant={client.clientType === 'COMPANY' ? 'purple' : 'default'}>
                              {client.clientType === 'COMPANY' ? 'Company' : 'Individual'}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{client.userId?.email ?? '—'}</p>
                          {client.clientCode && (
                            <p className="mt-0.5 font-mono text-xs text-gray-400">#{client.clientCode}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {client.company ? (
                        <span className="text-gray-700">{client.company}</span>
                      ) : <span className="text-gray-300">—</span>}
                      {client.website && (
                        <a href={client.website} target="_blank" rel="noreferrer"
                          className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-gray-900 hover:underline underline-offset-4">
                          <Globe className="size-3" />
                          {client.website.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.userId?.phone ? (
                        <div className="flex items-center gap-1.5 text-xs text-gray-600 tabular-nums">
                          <Phone className="size-3.5 text-gray-400" />
                          {client.userId.phone}
                        </div>
                      ) : <span className="text-xs text-gray-300">—</span>}
                      {client.country && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{client.country}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <p className="font-medium text-gray-900 tabular-nums">{client.activeProjectCount ?? 0}</p>
                      <p className="text-xs text-muted-foreground">active</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-medium text-gray-900"><TkAmt value={client.totalRevenue} /></span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {client.outstandingBalance > 0 ? (
                        <TkAmt value={client.outstandingBalance} className="font-medium text-amber-600" />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDate(client.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isActive ? 'success' : 'default'} dot>
                        {isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={KYC_VARIANT[kycStatus]}>{KYC_LABEL[kycStatus]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <RowMenu client={client} onEdit={openEdit} onDeactivate={handleDeactivate} onReactivate={handleReactivate} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {meta.pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />
          </div>
        )}
      </Card>

      <ClientModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        client={editingClient}
        onSaved={handleSaved}
      />
    </div>
  )
}
