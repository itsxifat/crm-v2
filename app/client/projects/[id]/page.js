'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  CheckCircle2, Circle, Clock, File, Download,
  AlertCircle, ChevronDown, ChevronUp, Layers, ChevronRight,
} from 'lucide-react'
import ProjectStatusBadge from '@/components/portals/ProjectStatusBadge'
import { formatMoney } from '@/lib/currencies'
import PageHeader from '@/components/ui/PageHeader'
import Button, { buttonVariants } from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

function TaskStatusBadge({ status }) {
  const map = {
    TODO:        { label: 'To do',       variant: 'default' },
    IN_PROGRESS: { label: 'In progress', variant: 'primary' },
    IN_REVIEW:   { label: 'In review',   variant: 'purple'  },
    COMPLETED:   { label: 'Completed',   variant: 'success' },
    CANCELLED:   { label: 'Cancelled',   variant: 'danger'  },
  }
  const s = map[status] || map.TODO
  return <Badge variant={s.variant}>{s.label}</Badge>
}

const INVOICE_BADGE = {
  PAID:           { label: 'Paid',           variant: 'success' },
  OVERDUE:        { label: 'Overdue',        variant: 'danger'  },
  PARTIALLY_PAID: { label: 'Partially paid', variant: 'warning' },
  SENT:           { label: 'Sent',           variant: 'primary' },
  CANCELLED:      { label: 'Cancelled',      variant: 'default' },
}

function Meta({ label, children, className }) {
  return (
    <div className={className}>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-gray-900">{children}</p>
    </div>
  )
}

export default function ClientProjectDetailPage() {
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAllTasks, setShowAllTasks] = useState(false)
  const [showAllMilestones, setShowAllMilestones] = useState(false)
  const [billing, setBilling] = useState(null)   // { data, summary, combined }

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/projects/${id}`)
      if (!res.ok) throw new Error('Project not found')
      const data = await res.json()
      setProject(data.project)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchProject() }, [fetchProject])

  // Invoices raised against this project, with their live paid / due figures.
  useEffect(() => {
    fetch(`/api/client/projects/${id}/invoices`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setBilling(d))
      .catch(() => {})
  }, [id])

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl animate-pulse space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-20 rounded-md bg-gray-100" />
          <div className="h-7 w-64 rounded-md bg-gray-100" />
        </div>
        <Card className="space-y-3 p-5">
          <div className="h-4 w-3/4 rounded-md bg-gray-100" />
          <div className="h-4 w-2/3 rounded-md bg-gray-100" />
          <div className="h-2 w-full rounded-full bg-gray-100" />
        </Card>
      </div>
    )
  }

  if (error || !project) {
    return (
      <Card className="mx-auto max-w-4xl">
        <EmptyState
          icon={AlertCircle}
          title={error || 'Project not found'}
          action={<Button variant="outline" size="sm" href="/client/projects">Back to projects</Button>}
        />
      </Card>
    )
  }

  const totalTasks = project.tasks?.length || 0
  const completedTasks = project.tasks?.filter((t) => t.status === 'COMPLETED').length || 0
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
  const completedMilestones = project.milestones?.filter((m) => m.completed).length || 0
  const totalMilestones = project.milestones?.length || 0

  const visibleTasks = showAllTasks ? project.tasks : project.tasks?.slice(0, 5)
  const visibleMilestones = showAllMilestones ? project.milestones : project.milestones?.slice(0, 5)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        back="/client/projects"
        backLabel="Projects"
        title={project.name}
        meta={<ProjectStatusBadge status={project.status} />}
      />

      {/* Overview */}
      <Card className="p-5">
        {project.description && (
          <p className="mb-5 max-w-2xl text-sm leading-relaxed text-gray-600">{project.description}</p>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {project.startDate && (
            <Meta label="Start date">{new Date(project.startDate).toLocaleDateString()}</Meta>
          )}
          {project.endDate && (
            <Meta label="Target date">{new Date(project.endDate).toLocaleDateString()}</Meta>
          )}
          <Meta label="Tasks">{completedTasks}/{totalTasks} done</Meta>
          <Meta label="Milestones">{completedMilestones}/{totalMilestones}</Meta>
        </div>

        {/* Progress */}
        <div className="mt-5 border-t border-gray-100 pt-5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium text-gray-900">Progress</span>
            <span className="font-medium tabular-nums text-gray-900">{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gray-900 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </Card>

      {/* Pricing */}
      {project.budget > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Meta label="Project value">{formatMoney(project.budget, project.currency)}</Meta>
            <Meta label="Paid"><span className="text-emerald-600">{formatMoney(project.paidAmount, project.currency)}</span></Meta>
            <Meta label="Due">
              <span className={project.dueAmount > 0 ? 'text-red-600' : 'text-emerald-600'}>
                {formatMoney(project.dueAmount, project.currency)}
              </span>
            </Meta>
          </CardContent>
        </Card>
      )}

      {/* Invoices */}
      {(billing?.data?.length ?? 0) > 0 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>
                {billing.data.length} invoice{billing.data.length === 1 ? '' : 's'}
              </CardDescription>
            </div>
            {billing.combined && (
              <CardAction>
                <Link href={`/client/invoices/combined/${billing.combined.id}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Layers /> Combined invoice
                </Link>
              </CardAction>
            )}
          </CardHeader>

          {/* Billing totals */}
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-y border-gray-100">
            {[
              { label: 'Total billed', value: billing.summary?.total,      cls: 'text-gray-900' },
              { label: 'Paid',         value: billing.summary?.paidAmount, cls: 'text-emerald-600' },
              { label: 'Due',          value: billing.summary?.due,        cls: (billing.summary?.due ?? 0) > 0.01 ? 'text-red-600' : 'text-emerald-600' },
            ].map(c => (
              <div key={c.label} className="px-5 py-3.5">
                <p className="text-[13px] text-muted-foreground">{c.label}</p>
                <p className={cn('mt-0.5 text-sm font-medium tabular-nums', c.cls)}>
                  {formatMoney(c.value, billing.summary?.currency)}
                </p>
              </div>
            ))}
          </div>

          <div className="divide-y divide-gray-100">
            {billing.data.map(inv => {
              const badge = INVOICE_BADGE[inv.status] ?? { label: inv.status.replace(/_/g, ' '), variant: 'primary' }
              return (
                <Link key={inv.id} href={`/client/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50/70">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{inv.invoiceNumber}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Issued {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : '—'}
                      {inv.dueDate ? ` · Due ${new Date(inv.dueDate).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums text-gray-900">
                        {formatMoney(inv.total, inv.currency)}
                      </p>
                      <p className={cn('mt-0.5 text-xs tabular-nums', inv.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
                        {inv.due > 0.01
                          ? `${formatMoney(inv.due, inv.currency)} due`
                          : 'Paid in full'}
                      </p>
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <ChevronRight className="size-4 text-gray-400" />
                  </div>
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      {/* Milestones */}
      {project.milestones?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="-mx-2 space-y-0.5">
              {visibleMilestones.map((milestone) => (
                <div key={milestone.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-gray-50/70">
                  {milestone.completed ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-gray-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium', milestone.completed ? 'text-gray-400 line-through' : 'text-gray-900')}>
                      {milestone.title}
                    </p>
                    {milestone.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{milestone.description}</p>
                    )}
                  </div>
                  {milestone.dueDate && (
                    <span className={cn(
                      'flex shrink-0 items-center gap-1 text-xs tabular-nums',
                      !milestone.completed && new Date(milestone.dueDate) < new Date()
                        ? 'text-red-600'
                        : 'text-muted-foreground'
                    )}>
                      <Clock className="size-3.5" />
                      {new Date(milestone.dueDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {project.milestones.length > 5 && (
              <Button variant="ghost" size="sm" className="-ml-2 mt-2" onClick={() => setShowAllMilestones(!showAllMilestones)}>
                {showAllMilestones ? <><ChevronUp />Show less</> : <><ChevronDown />Show all {project.milestones.length}</>}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tasks (client visible) */}
      {project.tasks?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
              {visibleTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                  {task.status === 'COMPLETED' ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-gray-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium', task.status === 'COMPLETED' ? 'text-gray-400' : 'text-gray-900')}>
                      {task.title}
                    </p>
                  </div>
                  <TaskStatusBadge status={task.status} />
                  {task.dueDate && (
                    <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                      {new Date(task.dueDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {project.tasks.length > 5 && (
              <Button variant="ghost" size="sm" className="-ml-2 mt-2" onClick={() => setShowAllTasks(!showAllTasks)}>
                {showAllTasks ? <><ChevronUp />Show less</> : <><ChevronDown />Show all {project.tasks.length}</>}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deliverables */}
      {project.documents?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Deliverables</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
              {project.documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                    <File className="size-4 text-gray-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{doc.name}</p>
                    {doc.description && <p className="text-xs text-muted-foreground">{doc.description}</p>}
                  </div>
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Download ${doc.name}`}
                    className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                  >
                    <Download />
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
