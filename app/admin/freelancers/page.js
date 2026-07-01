'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Eye, Pencil, Trash2, Ban, RotateCcw, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import Avatar from '@/components/ui/Avatar'
import ActionMenu from '@/components/ui/ActionMenu'
import FreelancerModal from '@/components/admin/freelancers/FreelancerModal'
import { formatCurrency } from '@/lib/utils'

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

function daysSince(d) {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)
}

function Activity({ lastWorkedAt }) {
  const days = daysSince(lastWorkedAt)
  if (days == null) return <span className="text-gray-300 text-xs">No activity</span>
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`
  const stale = days > 30
  return (
    <span className={`text-xs font-medium ${stale ? 'text-amber-600' : 'text-gray-600'}`}>
      {label}{stale && ' · inactive'}
    </span>
  )
}

function StatusCell({ f }) {
  if (!f.inviteAccepted) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-md font-medium border border-amber-200">
        <Mail className="w-3 h-3" /> Invited
      </span>
    )
  }
  const disabled = f.disabledAt || f.userId?.isActive === false
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${disabled ? 'text-rose-600' : 'text-green-700'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${disabled ? 'bg-rose-500' : 'bg-green-500'}`} />
      {disabled ? 'Disabled' : 'Active'}
    </span>
  )
}

export default function FreelancersPage() {
  const [freelancers, setFreelancers] = useState([])
  const [meta,        setMeta]        = useState({ page: 1, pages: 1, total: 0 })
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(1)
  const [activity,    setActivity]    = useState('all') // all | active | inactive
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editing,     setEditing]     = useState(null)

  const fetchFreelancers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20, type: 'FREELANCER' })
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
  }, [page, search])

  useEffect(() => { fetchFreelancers() }, [fetchFreelancers])

  function handleSaved() {
    toast.success(editing ? 'Freelancer updated' : 'Invitation sent!')
    setEditing(null)
    fetchFreelancers()
  }

  async function handleDelete(f) {
    if (!confirm(`Delete ${f.userId?.name}? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/freelancers/${f.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Deleted')
      fetchFreelancers()
    } catch (err) {
      toast.error(err.message ?? 'Failed to delete')
    }
  }

  async function handleToggle(f, disable) {
    if (disable && !confirm(`Disable ${f.userId?.name}'s account?`)) return
    try {
      const res = await fetch(`/api/freelancers/${f.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: disable ? 'disable' : 'enable' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(disable ? 'Account disabled' : 'Account reactivated')
      fetchFreelancers()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    }
  }

  const visible = freelancers.filter(f => {
    if (activity === 'active')   return (daysSince(f.finance?.lastWorkedAt) ?? 999) <= 30
    if (activity === 'inactive') return (daysSince(f.finance?.lastWorkedAt) ?? 999) > 30
    return true
  })

  return (
    <div className="space-y-6 mx-auto w-full max-w-7xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Freelancers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your freelancer network</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Freelancer
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1) }}
            placeholder="Search by name, email or skill…"
            className="w-full sm:w-80"
          />
          <div className="flex items-center gap-2">
            {[['all', 'All'], ['active', 'Recently active'], ['inactive', 'Inactive 30d+']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setActivity(k)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activity === k ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No freelancers found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Freelancer', 'Skills', 'Mode', 'Owed', 'Total Paid', 'Activity', 'Status', ''].map((h, i) => (
                    <th key={i} className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map((f) => {
                  const disabled = f.disabledAt || f.userId?.isActive === false
                  return (
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
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                          f.employmentMode === 'SALARY' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {f.employmentMode === 'SALARY' ? 'Salary' : 'Project'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">
                        {f.finance?.owedBDT ? formatCurrency(f.finance.owedBDT) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                        {f.finance?.paidBDT ? formatCurrency(f.finance.paidBDT) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-6 py-4"><Activity lastWorkedAt={f.finance?.lastWorkedAt} /></td>
                      <td className="px-6 py-4"><StatusCell f={f} /></td>
                      <td className="px-6 py-4 text-right">
                        <ActionMenu
                          items={[
                            { label: 'View details', icon: Eye, href: `/admin/freelancers/${f.id}` },
                            { label: 'Edit', icon: Pencil, onClick: () => { setEditing(f); setModalOpen(true) } },
                            disabled
                              ? { label: 'Reactivate', icon: RotateCcw, onClick: () => handleToggle(f, false) }
                              : { label: 'Disable', icon: Ban, onClick: () => handleToggle(f, true),
                                  disabled: f.finance?.hasUnpaid, hint: f.finance?.hasUnpaid ? 'owed' : undefined },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDelete(f),
                              disabled: f.finance?.hasUnpaid, hint: f.finance?.hasUnpaid ? 'owed' : undefined },
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
        defaultType="FREELANCER"
      />
    </div>
  )
}
