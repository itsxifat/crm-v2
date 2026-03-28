'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Building2, Plus, Eye, Pencil, Trash2, MoreHorizontal, Star, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import Avatar from '@/components/ui/Avatar'
import FreelancerModal from '@/components/admin/freelancers/FreelancerModal'

function SkillTags({ skills }) {
  if (!skills) return <span className="text-gray-400 text-xs">—</span>
  const list = skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3)
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((s) => (
        <span key={s} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-md font-medium">{s}</span>
      ))}
    </div>
  )
}

function InviteBadge({ accepted }) {
  if (accepted) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-md font-medium border border-amber-200">
      <Mail className="w-3 h-3" />
      Invited
    </span>
  )
}

const TABS = [
  { label: 'Freelancers', type: 'FREELANCER' },
  { label: 'Agencies',    type: 'AGENCY' },
]

export default function FreelancersPage() {
  const [activeTab,     setActiveTab]     = useState('FREELANCER')
  const [freelancers,   setFreelancers]   = useState([])
  const [meta,          setMeta]          = useState({ page: 1, pages: 1, total: 0 })
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [page,          setPage]          = useState(1)
  const [modalOpen,     setModalOpen]     = useState(false)
  const [editing,       setEditing]       = useState(null)
  const [menuOpen,      setMenuOpen]      = useState(null)

  const fetchFreelancers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20, type: activeTab })
      if (search) params.set('search', search)
      const res  = await fetch(`/api/freelancers?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setFreelancers(json.data ?? [])
      setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, search, activeTab])

  useEffect(() => { fetchFreelancers() }, [fetchFreelancers])

  // Reset page on tab change
  useEffect(() => { setPage(1); setSearch('') }, [activeTab])

  useEffect(() => {
    const handler = () => setMenuOpen(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  function handleSaved() {
    toast.success(editing ? `${activeTab === 'AGENCY' ? 'Agency' : 'Freelancer'} updated` : 'Invitation sent!')
    setEditing(null)
    fetchFreelancers()
  }

  async function handleDelete(f) {
    const label = activeTab === 'AGENCY'
      ? (f.agencyInfo?.agencyName ?? f.userId?.name)
      : f.userId?.name
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return
    setMenuOpen(null)
    try {
      const res = await fetch(`/api/freelancers/${f.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Deleted')
      fetchFreelancers()
    } catch (err) {
      toast.error(err.message ?? 'Failed to delete')
    }
  }

  const isAgencyTab = activeTab === 'AGENCY'
  const typeLabel   = isAgencyTab ? 'Agency' : 'Freelancer'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Freelancers & Agencies</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your freelancer and agency network</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add {typeLabel}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.type}
            onClick={() => setActiveTab(tab.type)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.type
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.type === 'AGENCY' ? <Building2 className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1) }}
            placeholder={isAgencyTab ? 'Search by agency name or email…' : 'Search by name, email or skill…'}
            className="w-80"
          />
          <span className="text-sm text-gray-400">{meta.total} {typeLabel.toLowerCase()}{meta.total !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : freelancers.length === 0 ? (
          <div className="text-center py-20">
            {isAgencyTab
              ? <Building2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              : <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            }
            <p className="text-gray-500 font-medium">No {typeLabel.toLowerCase()}s found</p>
            {search && <p className="text-gray-400 text-sm mt-1">Try a different search</p>}
          </div>
        ) : isAgencyTab ? (
          /* Agency table */
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Agency</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Person</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Agency Type</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Rate</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {freelancers.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{f.agencyInfo?.agencyName ?? '—'}</p>
                        <p className="text-xs text-gray-400">{f.userId?.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-700">{f.contactPerson?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{f.contactPerson?.designation ?? ''}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{f.agencyInfo?.type ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {f.hourlyRate ? (
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        ${f.hourlyRate}/{f.rateType?.toLowerCase() ?? 'hr'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${f.userId?.isActive ? 'text-green-700' : 'text-gray-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${f.userId?.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {f.userId?.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <InviteBadge accepted={f.inviteAccepted} />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="relative inline-block">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === f.id ? null : f.id) }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {menuOpen === f.id && (
                        <div className="absolute right-0 top-8 z-10 w-40 bg-white border border-gray-100 rounded-xl shadow-lg py-1" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/admin/freelancers/${f.id}`} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Eye className="w-4 h-4" /> View
                          </Link>
                          <button onClick={() => { setEditing(f); setModalOpen(true); setMenuOpen(null) }}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Pencil className="w-4 h-4" /> Edit
                          </button>
                          <button onClick={() => handleDelete(f)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* Freelancer table */
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Freelancer</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Skills</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Rate</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Wallet</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {freelancers.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={f.userId?.name} src={f.userId?.avatar} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{f.userId?.name}</p>
                        <p className="text-xs text-gray-400">{f.userId?.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4"><SkillTags skills={f.skills} /></td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {f.hourlyRate ? (
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        ${f.hourlyRate}/{f.rateType?.toLowerCase() ?? 'hr'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    ${(f.walletBalance ?? 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${f.userId?.isActive ? 'text-green-700' : 'text-gray-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${f.userId?.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {f.userId?.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <InviteBadge accepted={f.inviteAccepted} />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="relative inline-block">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === f.id ? null : f.id) }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {menuOpen === f.id && (
                        <div className="absolute right-0 top-8 z-10 w-40 bg-white border border-gray-100 rounded-xl shadow-lg py-1" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/admin/freelancers/${f.id}`} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Eye className="w-4 h-4" /> View
                          </Link>
                          <button onClick={() => { setEditing(f); setModalOpen(true); setMenuOpen(null) }}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Pencil className="w-4 h-4" /> Edit
                          </button>
                          <button onClick={() => handleDelete(f)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {meta.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100">
            <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />
          </div>
        )}
      </div>

      <FreelancerModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        freelancer={editing}
        onSaved={handleSaved}
        defaultType={activeTab}
      />
    </div>
  )
}
