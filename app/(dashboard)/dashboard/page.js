import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead, Project, Client, Task, Invoice, Transaction } from '@/models'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import {
  TrendingUp,
  Users,
  Briefcase,
  Wallet,
  Clock,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import StatsCard from '@/components/ui/StatsCard'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'

async function getDashboardStats() {
  await connectDB()

  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

  const [
    totalLeads,
    activeProjects,
    totalClients,
    pendingInvoices,
    overdueInvoices,
    recentLeads,
    recentProjects,
    pendingTasks,
    monthlyRevenueInvoices,
    recentTransactions,
  ] = await Promise.all([
    Lead.countDocuments(),
    Project.countDocuments({ status: { $in: ['PLANNING', 'IN_PROGRESS'] } }),
    Client.countDocuments(),
    Invoice.countDocuments({ status: 'SENT' }),
    Invoice.countDocuments({ status: 'OVERDUE' }),
    Lead.find().sort({ createdAt: -1 }).limit(5).lean(),
    Project.find().sort({ createdAt: -1 }).limit(5)
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name' } })
      .lean(),
    Task.countDocuments({ status: { $in: ['TODO', 'IN_PROGRESS'] } }),
    // aggregate() bypasses Mongoose post-find decryption hooks — Invoice.total is encrypted,
    // so $sum returns 0. Sum decrypted lean docs in JS instead.
    Invoice.find({ status: 'PAID', issueDate: { $gte: thisMonth } }).select('total').lean(),
    Transaction.find().sort({ createdAt: -1 }).limit(5).lean(),
  ])

  return {
    totalLeads,
    activeProjects,
    totalClients,
    pendingInvoices,
    overdueInvoices,
    recentLeads:        recentLeads.map(l => ({ ...l, id: l._id.toString() })),
    recentProjects:     recentProjects.map(p => ({ ...p, id: p._id.toString() })),
    pendingTasks,
    monthlyRevenue:     monthlyRevenueInvoices.reduce((s, i) => s + (Number(i.total) || 0), 0),
    recentTransactions: recentTransactions.map(t => ({ ...t, id: t._id.toString() })),
  }
}

const STATUS_VARIANT = {
  NEW:           'primary',
  CONTACTED:     'purple',
  PROPOSAL_SENT: 'warning',
  NEGOTIATION:   'orange',
  WON:           'success',
  LOST:          'danger',
  PLANNING:      'primary',
  IN_PROGRESS:   'warning',
  ON_HOLD:       'default',
  COMPLETED:     'success',
  CANCELLED:     'danger',
}

// "IN_PROGRESS" → "In progress" (display only)
const humanize = (s) => s ? (s.charAt(0) + s.slice(1).toLowerCase()).replace(/_/g, ' ') : ''

export const metadata = { title: 'Dashboard' }

function ListCard({ title, href, children }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Link href={href} className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), '-mr-1.5 -mt-1 text-muted-foreground')}>
            View all <ArrowUpRight className="size-3.5" />
          </Link>
        </CardAction>
      </CardHeader>
      <div className="divide-y divide-gray-100 border-t border-gray-100">{children}</div>
    </Card>
  )
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  const stats   = await getDashboardStats()

  const statCards = [
    {
      label:   'Total leads',
      value:   stats.totalLeads,
      icon:    TrendingUp,
      href:    '/leads',
      change:  '+12%',
      up:      true,
    },
    {
      label:   'Active projects',
      value:   stats.activeProjects,
      icon:    Briefcase,
      href:    '/projects',
      change:  '+3',
      up:      true,
    },
    {
      label:   'Total clients',
      value:   stats.totalClients,
      icon:    Users,
      href:    '/clients',
      change:  '+5%',
      up:      true,
    },
    {
      label:   'Monthly revenue',
      value:   formatCurrency(stats.monthlyRevenue),
      icon:    Wallet,
      href:    '/finance',
      change:  '+18%',
      up:      true,
    },
    {
      label:   'Pending invoices',
      value:   stats.pendingInvoices,
      icon:    Clock,
      color:   stats.overdueInvoices > 0 ? 'red' : 'gray',
      href:    '/invoices',
      change:  stats.overdueInvoices > 0 ? `${stats.overdueInvoices} overdue` : undefined,
      note:    stats.overdueInvoices > 0 ? undefined : 'All on time',
      up:      stats.overdueInvoices === 0,
    },
    {
      label:   'Open tasks',
      value:   stats.pendingTasks,
      icon:    CheckCircle2,
      href:    '/tasks',
      note:    'Across all projects',
      up:      true,
    },
  ]

  const firstName = session?.user?.name?.split(' ')[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Good ${getGreeting()}${firstName ? `, ${firstName}` : ''}`}
      />

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map((card) => (
          <StatsCard
            key={card.label}
            title={card.label}
            value={card.value}
            icon={card.icon}
            color={card.color ?? 'gray'}
            href={card.href}
            change={card.change}
            positive={card.up}
            changeLabel={card.note}
          />
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent leads */}
        <ListCard title="Recent leads" href="/leads">
          {stats.recentLeads.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No leads yet" className="py-10" />
          ) : (
            stats.recentLeads.map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-gray-50/70"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{lead.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{lead.company ?? lead.email ?? '—'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {lead.value && (
                    <span className="text-sm font-medium tabular-nums text-gray-900">
                      {formatCurrency(lead.value)}
                    </span>
                  )}
                  <Badge variant={STATUS_VARIANT[lead.status] ?? 'default'}>{humanize(lead.status)}</Badge>
                </div>
              </Link>
            ))
          )}
        </ListCard>

        {/* Recent projects */}
        <ListCard title="Active projects" href="/projects">
          {stats.recentProjects.length === 0 ? (
            <EmptyState icon={Briefcase} title="No projects yet" className="py-10" />
          ) : (
            stats.recentProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-gray-50/70"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{project.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {project.clientId?.userId?.name ?? project.clientId?.company ?? '—'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {project.budget && (
                    <span className="text-sm font-medium tabular-nums text-gray-900">
                      {formatCurrency(project.budget, project.currency)}
                    </span>
                  )}
                  <Badge variant={STATUS_VARIANT[project.status] ?? 'default'}>{humanize(project.status)}</Badge>
                </div>
              </Link>
            ))
          )}
        </ListCard>
      </div>

      {/* Recent transactions */}
      {stats.recentTransactions.length > 0 && (
        <ListCard title="Recent transactions" href="/finance">
          {stats.recentTransactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                  {tx.type === 'INCOME'
                    ? <ArrowUpRight   className="size-4 text-emerald-600" />
                    : <ArrowDownRight className="size-4 text-red-600" />
                  }
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{tx.description}</p>
                  <p className="text-xs text-muted-foreground">{tx.category} · {formatDate(tx.date)}</p>
                </div>
              </div>
              <span className={`shrink-0 text-sm font-medium tabular-nums ${tx.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
                {tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
              </span>
            </div>
          ))}
        </ListCard>
      )}
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}
