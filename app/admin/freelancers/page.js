'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Eye, Pencil, Trash2, Ban, RotateCcw, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import Avatar from '@/components/ui/Avatar'
import ActionMenu from '@/components/ui/ActionMenu'
import FreelancerModal from '@/components/admin/freelancers/FreelancerModal'
import InviteCredentialsModal from '@/components/admin/freelancers/InviteCredentialsModal'
import { formatCurrency } from '@/lib/utils'

function SkillTags({ skills }) {
  if (!skills) return <span className="text-xs text-gray-400">—</span>
  const list = skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3)
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((s) => (
        <Badge key={s} variant="outline">{s}</Badge>
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
  if (days == null) return <span className="text-xs text-gray-400">No activity</span>
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`
  const stale = days > 30
  return (
    <span className={`text-xs font-medium ${stale ? 'text-amber-600' : 'text-gray-600'}`}>
      {label}{stale && ' · inactive'}
    </span>
  )
}

function KycPill({ status }) {
  if (status === 'APPROVED') return <Badge variant="success">Verified</Badge>
  if (status === 'PENDING_APPROVAL') return <Badge variant="primary">Pending review</Badge>
  return <Badge variant="default">Unverified</Badge>
}

function StatusCell({ f }) {
  if (!f.inviteAccepted) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant="warning"><Mail className="size-3" /> Invited</Badge>
        <KycPill status={f.profileStatus} />
      </div>
    )
  }
  const disabled = f.disabledAt || f.userId?.isActive === false
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={disabled ? 'danger' : 'success'} dot>{disabled ? 'Disabled' : 'Active'}</Badge>
      <KycPill status={f.profileStatus} />
    </div>
  )
}

export default function FreelancersPage() {
  const [freelancers, setFreelancers] = useState([])
  const [meta,        setMeta]        = useState({ page: 1, pages: 1, total: 0 })
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(1)
  const [activity,    setActivity]    = useState('all') // all | active | inactive
  const [verify,      setVerify]      = useState('all') // all | pending | verified | unverified
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editing,     setEditing]     = useState(null)
  const [unsent,      setUnsent]      = useState(null)  // create result whose invite email failed

  const fetchFreelancers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20, type: 'FREELANCER' })
      if (search) params.set('search', search)
      if (verify !== 'all') params.set('verification', verify)
      if (activity !== 'all') params.set('activity', activity)
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
  }, [page, search, verify, activity])

  useEffect(() => { fetchFreelancers() }, [fetchFreelancers])

  function handleSaved(result) {
    const wasEditing = !!editing
    setEditing(null)
    fetchFreelancers()

    if (wasEditing) { toast.success('Freelancer updated'); return }

    // Be honest about email delivery: the API returns 201 even when the invite
    // email fails to send (SMTP not configured, etc.). Don't claim "sent" then.
    if (result?.emailSent === false) {
      // Show the link / temp password (returned only once) so it can be shared manually.
      if (result.link || result.tempPassword) setUnsent(result)
      else toast.error('Freelancer created, but the invite email failed', { duration: 8000 })
      return
    }

    toast.success('Invitation sent')
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

  // The activity filter is applied server-side (before pagination).
  const visible = freelancers

  return (
    <div className="space-y-6">
      <PageHeader
        title="Freelancers"
        actions={<Button onClick={() => { setEditing(null); setModalOpen(true) }}><Plus /> New freelancer</Button>}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1) }}
            placeholder="Search…"
            className="w-full sm:w-64"
          />
          <Tabs
            size="sm"
            value={verify}
            onChange={(k) => { setVerify(k); setPage(1) }}
            tabs={[
              { value: 'all', label: 'All' },
              { value: 'pending', label: 'Pending review' },
              { value: 'verified', label: 'Verified' },
              { value: 'unverified', label: 'Unverified' },
            ]}
          />
          <Tabs
            size="sm"
            value={activity}
            onChange={(k) => { setActivity(k); setPage(1) }}
            tabs={[
              { value: 'all', label: 'Any activity' },
              { value: 'active', label: 'Recently active' },
              { value: 'inactive', label: 'Inactive 30d+' },
            ]}
          />
        </div>

        {loading ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <EmptyState icon={Users} title="No freelancers found" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Freelancer</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead className="text-right">Total paid</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((f) => {
                const disabled = f.disabledAt || f.userId?.isActive === false
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={f.userId?.name} src={f.userId?.avatar} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">{f.userId?.name}</p>
                          <p className="text-xs text-muted-foreground">{f.userId?.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><SkillTags skills={f.skills} /></TableCell>
                    <TableCell>
                      <Badge variant={f.employmentMode === 'SALARY' ? 'indigo' : 'default'}>
                        {f.employmentMode === 'SALARY' ? 'Salary' : 'Project'}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">
                      {f.finance?.owedBDT ? formatCurrency(f.finance.owedBDT) : <span className="text-gray-300">—</span>}
                      {f.finance?.owedOther?.map(o => <div key={o.currency} className="text-xs font-normal text-muted-foreground">{o.currency} {Number(o.total).toLocaleString()}</div>)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {f.finance?.paidBDT ? formatCurrency(f.finance.paidBDT) : <span className="text-gray-300">—</span>}
                    </TableCell>
                    <TableCell><Activity lastWorkedAt={f.finance?.lastWorkedAt} /></TableCell>
                    <TableCell><StatusCell f={f} /></TableCell>
                    <TableCell className="text-right">
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

      <FreelancerModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        freelancer={editing}
        onSaved={handleSaved}
        defaultType="FREELANCER"
      />

      <InviteCredentialsModal result={unsent} onClose={() => setUnsent(null)} label="Freelancer" />
    </div>
  )
}
