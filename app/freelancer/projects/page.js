'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { FolderOpen } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Card } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const ASSIGNMENT_STATUS_VARIANT = {
  ASSIGNED:    'primary',
  ACCEPTED:    'teal',
  IN_PROGRESS: 'purple',
  COMPLETED:   'success',
  CANCELLED:   'danger',
}

// Keys match FreelancerAssignment.paymentStatus
const PAYMENT_STATUS_LABEL = {
  PENDING:            { label: 'Not requested',    variant: 'default' },
  PAYMENT_REQUESTED:  { label: 'Awaiting payment', variant: 'warning' },
  PAID:               { label: 'Paid',             variant: 'success' },
  NOT_REQUIRED:       { label: 'Salary',           variant: 'indigo' },
}

const VENTURE_VARIANT = {
  ENSTUDIO: 'purple',
  ENTECH:   'primary',
  ENMARK:   'success',
}

const humanize = (s) => {
  const t = String(s).replace(/_/g, ' ').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export default function FreelancerProjectsPage() {
  const [assignments, setAssignments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [acting,      setActing]      = useState(null)

  async function load() {
    try {
      const res  = await fetch('/api/freelancer/dashboard')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAssignments(json.data?.assignments ?? [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function acceptAssignment(assignmentId) {
    setActing(assignmentId)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'accept' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Assignment accepted')
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActing(null)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <PageHeader title="Projects" />

      <Card className="overflow-hidden">
        {assignments.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No assignments yet" />
        ) : (
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Venture</TableHead>
                <TableHead className="text-right">My payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-24"><span className="sr-only">Action</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map(a => {
                const pay = PAYMENT_STATUS_LABEL[a.paymentStatus] ?? PAYMENT_STATUS_LABEL.PENDING
                return (
                  <TableRow key={a.id ?? a._id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.projectId?.projectCode ?? '—'}
                    </TableCell>
                    <TableCell className="font-medium text-gray-900">{a.projectId?.name ?? '—'}</TableCell>
                    <TableCell>
                      {a.projectId?.venture
                        ? <Badge variant={VENTURE_VARIANT[a.projectId.venture] ?? 'default'}>{a.projectId.venture}</Badge>
                        : <span className="text-gray-300">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-gray-900">
                      {a.paymentAmount ? formatCurrency(a.paymentAmount, a.currency) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ASSIGNMENT_STATUS_VARIANT[a.status] ?? 'default'}>{humanize(a.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={pay.variant}>{pay.label}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(a.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {a.status === 'ASSIGNED' && (
                        <Button
                          size="xs"
                          onClick={() => acceptAssignment(a.id ?? a._id)}
                          loading={acting === (a.id ?? a._id)}
                        >
                          Accept
                        </Button>
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
