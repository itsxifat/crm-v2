import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead, Project, Client, Task, Invoice, Transaction } from '@/models'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  TrendingUp,
  Users,
  Briefcase,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import Link from 'next/link'

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
    monthlyRevenueAgg,
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
    Invoice.aggregate([
      { $match: { status: 'PAID', issueDate: { $gte: thisMonth } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
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
    monthlyRevenue:     monthlyRevenueAgg[0]?.total ?? 0,
    recentTransactions: recentTransactions.map(t => ({ ...t, id: t._id.toString() })),
  }
}

const STATUS_COLORS = {
  NEW:         'bg-blue-100 text-blue-700',
  CONTACTED:   'bg-purple-100 text-purple-700',
  PROPOSAL_SENT: 'bg-yellow-100 text-yellow-700',
  NEGOTIATION: 'bg-orange-100 text-orange-700',
  WON:         'bg-green-100 text-green-700',
  LOST:        'bg-red-100 text-red-700',
  PLANNING:    'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  ON_HOLD:     'bg-gray-100 text-gray-600',
  COMPLETED:   'bg-green-100 text-green-700',
  CANCELLED:   'bg-red-100 text-red-700',
}

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  const stats   = await getDashboardStats()

  const statCards = [
    {
      label:   'Total Leads',
      value:   stats.totalLeads,
      icon:    TrendingUp,
      color:   'text-blue-600',
      bg:      'bg-blue-50',
      href:    '/leads',
      change:  '+12%',
      up:      true,
    },
    {
      label:   'Active Projects',
      value:   stats.activeProjects,
      icon:    Briefcase,
      color:   'text-purple-600',
      bg:      'bg-purple-50',
      href:    '/projects',
      change:  '+3',
      up:      true,
    },
    {
      label:   'Total Clients',
      value:   stats.totalClients,
      icon:    Users,
      color:   'text-green-600',
      bg:      'bg-green-50',
      href:    '/clients',
      change:  '+5%',
      up:      true,
    },
    {
      label:   'Monthly Revenue',
      value:   formatCurrency(stats.monthlyRevenue),
      icon:    DollarSign,
      color:   'text-emerald-600',
      bg:      'bg-emerald-50',
      href:    '/finance',
      change:  '+18%',
      up:      true,
    },
    {
      label:   'Pending Invoices',
      value:   stats.pendingInvoices,
      icon:    Clock,
      color:   'text-yellow-600',
      bg:      'bg-yellow-50',
      href:    '/invoices',
      change:  stats.overdueInvoices > 0 ? `${stats.overdueInvoices} overdue` : 'All on-time',
      up:      stats.overdueInvoices === 0,
    },
    {
      label:   'Open Tasks',
      value:   stats.pendingTasks,
      icon:    CheckCircle2,
      color:   'text-pink-600',
      bg:      'bg-pink-50',
      href:    '/tasks',
      change:  'Across all projects',
      up:      true,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Good {getGreeting()}, {session?.user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Here&apos;s what&apos;s happening in your agency today.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.label}
              href={card.href}
              className="card p-6 hover:shadow-card-hover transition-shadow duration-200 group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="stats-label">{card.label}</p>
                  <p className="stats-value">{card.value}</p>
                  <div className={card.up ? 'stats-change-positive' : 'stats-change-negative'}>
                    {card.up
                      ? <ArrowUpRight className="w-3 h-3" />
                      : <AlertCircle   className="w-3 h-3" />
                    }
                    <span>{card.change}</span>
                  </div>
                </div>
                <div className={`w-12 h-12 ${card.bg} rounded-xl flex-center group-hover:scale-110 transition-transform duration-200`}>
                  <Icon className={`w-5 h-5 ${card.color}`} />
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Leads */}
        <div className="card">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Leads</h2>
            <Link href="/leads" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.recentLeads.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-gray-400">No leads yet.</p>
            ) : (
              stats.recentLeads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{lead.name}</p>
                    <p className="text-xs text-gray-500 truncate">{lead.company ?? lead.email ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {lead.value && (
                      <span className="text-xs font-semibold text-gray-700">
                        {formatCurrency(lead.value)}
                      </span>
                    )}
                    <span className={`badge text-2xs ${STATUS_COLORS[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {lead.status.replace('_', ' ')}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent Projects */}
        <div className="card">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Active Projects</h2>
            <Link href="/projects" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.recentProjects.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-gray-400">No projects yet.</p>
            ) : (
              stats.recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{project.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {project.clientId?.userId?.name ?? project.clientId?.company ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {project.budget && (
                      <span className="text-xs font-semibold text-gray-700">
                        {formatCurrency(project.budget, project.currency)}
                      </span>
                    )}
                    <span className={`badge text-2xs ${STATUS_COLORS[project.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {project.status.replace('_', ' ')}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      {stats.recentTransactions.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Transactions</h2>
            <Link href="/finance" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-6 py-3.5">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex-center ${tx.type === 'INCOME' ? 'bg-green-50' : 'bg-red-50'}`}>
                    {tx.type === 'INCOME'
                      ? <ArrowUpRight   className="w-4 h-4 text-green-600" />
                      : <ArrowDownRight className="w-4 h-4 text-red-600" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{tx.description}</p>
                    <p className="text-xs text-gray-500">{tx.category} · {formatDate(tx.date)}</p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${tx.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}`}>
                  {tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
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
