'use client'

import { useState, useEffect, useCallback } from 'react'
import { KeyRound, Check, X, Loader2, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { Card } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

const STATUS_META = {
  PENDING:   { label: 'Pending',   variant: 'warning' },
  APPROVED:  { label: 'Approved',  variant: 'primary' },
  REJECTED:  { label: 'Rejected',  variant: 'danger'  },
  COMPLETED: { label: 'Completed', variant: 'success' },
}

function timeAgo(d) {
  if (!d) return '—'
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(d).toLocaleDateString()
}

export default function PasswordRequestsPage() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/password-reset-requests')
      if (res.status === 403) { setForbidden(true); return }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRows(json.data ?? [])
    } catch (err) {
      toast.error(err.message ?? 'Failed to load requests')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function act(row, action) {
    const verb = action === 'approve' ? 'Approve' : 'Reject'
    if (!confirm(`${verb} the password reset for ${row.email}?`)) return
    setBusy(row.id)
    try {
      const res  = await fetch(`/api/password-reset-requests/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(action === 'approve'
        ? (json.emailSent ? 'Approved — reset link emailed' : 'Approved (email failed to send)')
        : 'Request rejected')
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (forbidden) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No access"
        description="You can't manage password reset requests."
        className="py-24"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Password resets" description="Approving emails a one-time reset link" />

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingSpinner className="py-16" />
        ) : rows.length === 0 ? (
          <EmptyState icon={KeyRound} title="No reset requests" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const meta = STATUS_META[r.status] ?? STATUS_META.PENDING
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-medium text-gray-900">{r.user?.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {r.client ? `${r.client.company || r.client.clientCode}` : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {timeAgo(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {r.reviewedBy && <span className="mt-0.5 block text-[11px] text-muted-foreground">by {r.reviewedBy}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {r.status === 'PENDING' ? (
                        <div className="inline-flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => act(r, 'reject')}
                            disabled={busy === r.id}
                            className="text-red-600 hover:text-red-700"
                          >
                            <X /> Reject
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => act(r, 'approve')}
                            disabled={busy === r.id}
                          >
                            {busy === r.id ? <Loader2 className="animate-spin" /> : <Check />} Approve
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
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
