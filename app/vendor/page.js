'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { FolderOpen, Activity, PackageCheck } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import StatsCard from '@/components/ui/StatsCard'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_VARIANT = {
  PENDING:     'default',
  IN_PROGRESS: 'primary',
  IN_REVIEW:   'purple',
  REVISION:    'warning',
  APPROVED:    'teal',
  DELIVERED:   'success',
  ON_HOLD:     'warning',
  CANCELLED:   'danger',
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

export default function VendorDashboard() {
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/projects?limit=100')
      .then(r => r.json())
      .then(j => setProjects(j.data ?? []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatsCard title="Total projects" value={projects.length} icon={FolderOpen} />
        <StatsCard title="Active" value={projects.filter(p => p.status === 'IN_PROGRESS').length} icon={Activity} />
        <StatsCard title="Delivered" value={projects.filter(p => p.status === 'DELIVERED').length} icon={PackageCheck} />
      </div>

      {/* Projects table */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-gray-100 pb-4">
          <CardTitle>Projects</CardTitle>
        </CardHeader>

        {projects.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No projects yet" />
        ) : (
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Venture</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start date</TableHead>
                <TableHead>Deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map(p => (
                <TableRow key={p.id ?? p._id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.projectCode ?? '—'}</TableCell>
                  <TableCell className="font-medium text-gray-900">{p.name}</TableCell>
                  <TableCell>
                    {p.venture
                      ? <Badge variant={VENTURE_VARIANT[p.venture] ?? 'default'}>{p.venture}</Badge>
                      : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell>
                    {p.status
                      ? <Badge variant={STATUS_VARIANT[p.status] ?? 'default'}>{humanize(p.status)}</Badge>
                      : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(p.startDate)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(p.deadline)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
