'use client'

import { useState, useEffect, useCallback } from 'react'
import { Building2, Plus, Eye, Pencil, Trash2, Ban, RotateCcw, Mail } from 'lucide-react'
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
import ActionMenu from '@/components/ui/ActionMenu'
import FreelancerModal from '@/components/admin/freelancers/FreelancerModal'
import InviteCredentialsModal from '@/components/admin/freelancers/InviteCredentialsModal'
import { formatCurrency } from '@/lib/utils'

function InviteBadge({ accepted }) {
  if (accepted) return null
  return <Badge variant="warning"><Mail className="size-3" /> Invited</Badge>
}

function KycPill({ status }) {
  if (status === 'APPROVED') return <Badge variant="success">Verified</Badge>
  if (status === 'PENDING_APPROVAL') return <Badge variant="primary">Pending review</Badge>
  return <Badge variant="default">Unverified</Badge>
}

export default function AgenciesPage() {
  const [agencies,   setAgencies]   = useState([])
  const [meta,       setMeta]       = useState({ page: 1, pages: 1, total: 0 })
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [page,       setPage]       = useState(1)
  const [verify,     setVerify]     = useState('all') // all | pending | verified | unverified
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [unsent,     setUnsent]     = useState(null)  // create result whose invite email failed

  const fetchAgencies = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20, type: 'AGENCY' })
      if (search) params.set('search', search)
      if (verify !== 'all') params.set('verification', verify)
      const res  = await fetch(`/api/freelancers?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAgencies(json.data ?? [])
      setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, search, verify])

  useEffect(() => { fetchAgencies() }, [fetchAgencies])

  function handleSaved(result) {
    const wasEditing = !!editing
    setEditing(null)
    fetchAgencies()

    if (wasEditing) { toast.success('Agency updated'); return }

    // The API returns 201 even when the invite email fails; the link / temp
    // password is returned only once, so show it for manual sharing.
    if (result?.emailSent === false) {
      if (result.link || result.tempPassword) setUnsent(result)
      else toast.error('Agency created, but the invite email failed', { duration: 8000 })
      return
    }

    toast.success('Invitation sent')
  }

  async function handleDelete(f) {
    const label = f.agencyInfo?.agencyName ?? f.userId?.name
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/freelancers/${f.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Deleted')
      fetchAgencies()
    } catch (err) {
      toast.error(err.message ?? 'Failed to delete')
    }
  }

  async function handleToggle(f, disable) {
    if (disable && !confirm(`Disable ${f.agencyInfo?.agencyName ?? f.userId?.name}'s account?`)) return
    try {
      const res = await fetch(`/api/freelancers/${f.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: disable ? 'disable' : 'enable' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(disable ? 'Account disabled' : 'Account reactivated')
      fetchAgencies()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agencies"
        actions={<Button onClick={() => { setEditing(null); setModalOpen(true) }}><Plus /> New agency</Button>}
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
        </div>

        {loading ? (
          <PageLoader />
        ) : agencies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={search ? 'No results' : 'No agencies found'}
            description={search ? 'Try a different search' : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead>Contact person</TableHead>
                <TableHead>Agency type</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {agencies.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                        <Building2 className="size-4 text-gray-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{f.agencyInfo?.agencyName ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{f.userId?.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-gray-900">{f.contactPerson?.name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{f.contactPerson?.designation ?? ''}</p>
                  </TableCell>
                  <TableCell>{f.agencyInfo?.type ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">
                    {f.finance?.owedBDT ? formatCurrency(f.finance.owedBDT) : <span className="text-gray-300">—</span>}
                    {f.finance?.owedOther?.map(o => <div key={o.currency} className="text-xs font-normal text-muted-foreground">{o.currency} {Number(o.total).toLocaleString()}</div>)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(() => {
                        const disabled = f.disabledAt || f.userId?.isActive === false
                        return <Badge variant={disabled ? 'danger' : 'success'} dot>{disabled ? 'Disabled' : 'Active'}</Badge>
                      })()}
                      <InviteBadge accepted={f.inviteAccepted} />
                      <KycPill status={f.profileStatus} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {(() => {
                      const disabled = f.disabledAt || f.userId?.isActive === false
                      return (
                        <ActionMenu
                          items={[
                            { label: 'View details', icon: Eye, href: `/admin/agencies/${f.id}` },
                            { label: 'Edit', icon: Pencil, onClick: () => { setEditing(f); setModalOpen(true) } },
                            disabled
                              ? { label: 'Reactivate', icon: RotateCcw, onClick: () => handleToggle(f, false) }
                              : { label: 'Disable', icon: Ban, onClick: () => handleToggle(f, true),
                                  disabled: f.finance?.hasUnpaid, hint: f.finance?.hasUnpaid ? 'owed' : undefined },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDelete(f),
                              disabled: f.finance?.hasUnpaid, hint: f.finance?.hasUnpaid ? 'owed' : undefined },
                          ]}
                        />
                      )
                    })()}
                  </TableCell>
                </TableRow>
              ))}
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
        defaultType="AGENCY"
      />

      <InviteCredentialsModal result={unsent} onClose={() => setUnsent(null)} label="Agency" />
    </div>
  )
}
