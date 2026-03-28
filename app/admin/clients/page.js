'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Users, DollarSign, TrendingUp, FolderOpen,
  Plus, MoreHorizontal, Pencil, Trash2, Eye,
  Mail, Phone, Building2, Globe,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import ClientModal from '@/components/admin/clients/ClientModal'
import TkAmt from '@/components/ui/TkAmt'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) => n ? `৳ ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function StatCard({ label, value, icon: Icon, color }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    yellow: 'bg-yellow-50 text-yellow-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  )
}

// ─── Row Menu ─────────────────────────────────────────────────────────────────

function RowMenu({ client, onEdit, onDeactivate }) {
  const [open, setOpen]   = useState(false)
  const [pos,  setPos]    = useState({ top: 0, left: 0 })
  const btnRef            = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  function toggle(e) {
    e.stopPropagation()
    if (!open) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + window.scrollY + 4, left: rect.right + window.scrollX - 160 })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button ref={btnRef} onClick={toggle}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-40 bg-white border border-gray-100 rounded-xl shadow-lg py-1"
          onClick={e => e.stopPropagation()}
        >
          <Link href={`/admin/clients/${client.id}`}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Eye className="w-3.5 h-3.5" /> View
          </Link>
          <button onClick={() => { setOpen(false); onEdit(client) }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button onClick={() => { setOpen(false); onDeactivate(client) }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" /> Deactivate
          </button>
        </div>
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [clients,       setClients]       = useState([])
  const [stats,         setStats]         = useState(null)
  const [meta,          setMeta]          = useState({ page: 1, pages: 1, total: 0 })
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [page,          setPage]          = useState(1)
  const [modalOpen,     setModalOpen]     = useState(false)
  const [editingClient, setEditingClient] = useState(null)

  const fetchClients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search) params.set('search', search)
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
  }, [page, search])

  useEffect(() => { fetchClients() }, [fetchClients])

  function handleSaved(client, _, emailSent) {
    if (!editingClient) {
      toast.success(emailSent !== false ? 'Client created! Login credentials sent to their email.' : 'Client created! (Email delivery failed — check SMTP config)', { duration: 6000 })
    } else {
      toast.success('Client updated')
    }
    setEditingClient(null)
    fetchClients()
  }

  function openEdit(client) { setEditingClient(client); setModalOpen(true) }

  async function handleDeactivate(client) {
    if (!confirm(`Deactivate ${client.userId?.name}? They will lose portal access.`)) return
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Client deactivated')
      fetchClients()
    } catch (err) {
      toast.error(err.message ?? 'Failed to deactivate')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage client accounts and relationships</p>
        </div>
        <button
          onClick={() => { setEditingClient(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Client
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Clients"   value={stats.totalClients}                                       icon={Users}      color="blue"   />
          <StatCard label="Total Revenue"   value={fmt(stats.totalRevenue)}                                  icon={DollarSign} color="green"  />
          <StatCard label="Outstanding"     value={fmt(stats.outstandingBalance)}                            icon={TrendingUp} color="yellow" />
          <StatCard label="Active Projects" value={stats.activeProjectCount ?? 0}                            icon={FolderOpen} color="purple" />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100">
        {/* Toolbar */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-4">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1) }}
            placeholder="Search by name, email, company…"
            className="w-72"
          />
          <span className="text-sm text-gray-400">{meta.total} client{meta.total !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">No clients found</p>
            {search && <p className="text-gray-400 text-xs mt-1">Try a different search term</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Client</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Company</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Contact</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wide">Projects</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Revenue</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Outstanding</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Joined</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">KYC</th>
                  <th className="px-5 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map((client) => {
                  const isActive = client.userId?.isActive
                  return (
                    <tr key={client.id} className="hover:bg-gray-50/60 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar name={client.userId?.name} src={client.userId?.avatar} size="sm" />
                          <div>
                            <Link href={`/admin/clients/${client.id}`}
                              className="text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                              {client.userId?.name ?? '—'}
                            </Link>
                            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              {client.userId?.email ?? '—'}
                            </p>
                            {client.clientCode && (
                              <p className="text-xs text-gray-400 mt-0.5 font-mono">#{client.clientCode}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {client.company ? (
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                            <span className="text-sm text-gray-700">{client.company}</span>
                          </div>
                        ) : <span className="text-sm text-gray-300">—</span>}
                        {client.website && (
                          <a href={client.website} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-600 mt-0.5">
                            <Globe className="w-3 h-3" />
                            {client.website.replace(/^https?:\/\//, '')}
                          </a>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {client.userId?.phone ? (
                          <div className="flex items-center gap-1.5 text-xs text-gray-600">
                            <Phone className="w-3.5 h-3.5 text-gray-300" />
                            {client.userId.phone}
                          </div>
                        ) : <span className="text-xs text-gray-300">—</span>}
                        {client.country && (
                          <p className="text-xs text-gray-400 mt-0.5">{client.country}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <p className="text-sm font-medium text-gray-800">{client.activeProjectCount ?? 0}</p>
                        <p className="text-xs text-gray-400">active</p>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <p className="text-sm font-semibold text-gray-900"><TkAmt value={client.totalRevenue} /></p>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {client.outstandingBalance > 0 ? (
                          <TkAmt value={client.outstandingBalance} className="text-sm font-medium text-amber-600" />
                        ) : (
                          <span className="text-sm text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-gray-500">{fmtDate(client.createdAt)}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${isActive ? 'text-green-700' : 'text-gray-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {(() => {
                          const s = client.kyc?.status ?? 'NOT_SUBMITTED'
                          const MAP = {
                            NOT_SUBMITTED: 'bg-gray-100 text-gray-500',
                            PENDING:       'bg-yellow-50 text-yellow-700',
                            VERIFIED:      'bg-green-50 text-green-700',
                            REJECTED:      'bg-red-50 text-red-600',
                          }
                          const LABELS = { NOT_SUBMITTED: 'No KYC', PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Rejected' }
                          return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${MAP[s]}`}>{LABELS[s]}</span>
                        })()}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <RowMenu client={client} onEdit={openEdit} onDeactivate={handleDeactivate} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta.pages > 1 && (
          <div className="px-5 py-4 border-t border-gray-100">
            <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />
          </div>
        )}
      </div>

      <ClientModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        client={editingClient}
        onSaved={handleSaved}
      />
    </div>
  )
}
